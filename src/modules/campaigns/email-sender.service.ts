import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { getSupabaseAdminClient } from '../../config/supabase.config';
import { BrevoService } from './brevo.service';

interface EmailToSend {
  id: string;
  campaign_id: string;
  csv_contact_id: string;
  email_address: string;
  recipient_name: string | null;
  csv_contact?: {
    first_name?: string;
    last_name?: string;
    email: string;
    custom_fields?: Record<string, unknown>;
  };
}

interface CampaignData {
  id: string;
  status: string;
  template_id: string;
  from_name: string;
  from_email: string;
  reply_to: string | null;
  subject_override: string | null;
  send_options: Record<string, unknown>;
  template?: {
    subject: string;
    body_html: string;
    body_text: string;
    variables: string[];
  };
}

@Injectable()
export class EmailSenderService implements OnModuleInit {
  private readonly logger = new Logger(EmailSenderService.name);
  private supabase = getSupabaseAdminClient();
  private activeCampaigns = new Map<string, boolean>();

  constructor(
    private configService: ConfigService,
    private brevoService: BrevoService,
  ) {}

  async onModuleInit() {
    this.logger.log('EmailSenderService initialized with Brevo integration');
  }

  async startSending(campaignId: string): Promise<void> {
    if (this.activeCampaigns.get(campaignId)) {
      this.logger.warn(`Campaign ${campaignId} is already being sent`);
      return;
    }

    this.activeCampaigns.set(campaignId, true);
    this.logger.log(`Starting email sending for campaign ${campaignId} via Brevo`);

    try {
      await this.sendCampaignEmails(campaignId);
    } catch (error) {
      this.logger.error(`Error sending campaign ${campaignId}:`, error);
    } finally {
      this.activeCampaigns.delete(campaignId);
    }
  }

  async stopSending(campaignId: string): Promise<void> {
    this.activeCampaigns.set(campaignId, false);
    this.logger.log(`Stopping email sending for campaign ${campaignId}`);
  }

  private async sendCampaignEmails(campaignId: string): Promise<void> {
    // Get campaign with template
    const { data: campaign, error: campaignError } = await this.supabase
      .from('campaigns')
      .select(`
        *,
        template:templates!campaigns_template_id_fkey(subject, body_html, body_text, variables)
      `)
      .eq('id', campaignId)
      .single();

    if (campaignError || !campaign) {
      this.logger.error(`Campaign fetch error: ${JSON.stringify(campaignError)}`);
      throw new Error(`Campaign not found: ${campaignId}`);
    }

    this.logger.log(`Campaign loaded: ${campaign.name}, Template: ${JSON.stringify(campaign.template)}`);
    
    const campaignData = campaign as CampaignData;

    // Get pending emails with contact data
    const { data: emails, error: emailsError } = await this.supabase
      .from('campaign_emails')
      .select(`
        *,
        csv_contact:csv_contacts(first_name, last_name, email, custom_fields)
      `)
      .eq('campaign_id', campaignId)
      .eq('status', 'pending')
      .order('created_at', { ascending: true });

    if (emailsError) {
      throw emailsError;
    }

    if (!emails || emails.length === 0) {
      this.logger.log(`No pending emails for campaign ${campaignId}`);
      await this.markCampaignComplete(campaignId);
      return;
    }

    const totalEmails = emails.length;
    let sentCount = 0;
    let failedCount = 0;
    let skippedCount = 0;

    // Get current stats
    const { data: currentCampaign } = await this.supabase
      .from('campaigns')
      .select('stats')
      .eq('id', campaignId)
      .single();

    const currentStats = currentCampaign?.stats || {
      total: totalEmails,
      sent: 0,
      delivered: 0,
      opened: 0,
      clicked: 0,
      bounced: 0,
      failed: 0,
      unsubscribed: 0,
    };

    for (const email of emails as EmailToSend[]) {
      // Check if we should continue
      if (!this.activeCampaigns.get(campaignId)) {
        this.logger.log(`Campaign ${campaignId} sending stopped`);
        break;
      }

      // Check if campaign status changed
      const { data: statusCheck } = await this.supabase
        .from('campaigns')
        .select('status')
        .eq('id', campaignId)
        .single();

      if (statusCheck?.status !== 'sending') {
        this.logger.log(`Campaign ${campaignId} status changed to ${statusCheck?.status}`);
        break;
      }

      // Check if email is unsubscribed
      const isUnsubscribed = await this.brevoService.isUnsubscribed(email.email_address);
      if (isUnsubscribed) {
        this.logger.log(`Skipping unsubscribed email: ${email.email_address}`);
        
        await this.supabase
          .from('campaign_emails')
          .update({
            status: 'unsubscribed',
            error_message: 'Email previously unsubscribed',
          })
          .eq('id', email.id);

        skippedCount++;
        continue;
      }

      try {
        // Prepare email content
        const emailContent = this.prepareEmailContent(campaignData, email);

        // Send via Brevo
        const result = await this.brevoService.sendTransactionalEmail(
          email.email_address,
          email.recipient_name || undefined,
          campaignData.from_email,
          campaignData.from_name,
          campaignData.reply_to || undefined,
          emailContent.subject,
          emailContent.html,
          emailContent.text,
          campaignId,
          email.id,
        );

        if (result.success) {
          // Update email status
          await this.supabase
            .from('campaign_emails')
            .update({
              status: 'sent',
              sent_at: new Date().toISOString(),
              brevo_message_id: result.messageId,
            })
            .eq('id', email.id);

          // Record sent event
          await this.supabase.from('email_events').insert({
            campaign_email_id: email.id,
            event_type: 'sent',
            occurred_at: new Date().toISOString(),
            event_data: { brevo_message_id: result.messageId },
          });

          sentCount++;
        } else {
          throw new Error('Brevo sending failed');
        }
      } catch (error) {
        this.logger.error(`Failed to send email ${email.id}:`, error);

        await this.supabase
          .from('campaign_emails')
          .update({
            status: 'failed',
            error_message: (error as Error).message,
          })
          .eq('id', email.id);

        // Record failed event
        await this.supabase.from('email_events').insert({
          campaign_email_id: email.id,
          event_type: 'failed',
          occurred_at: new Date().toISOString(),
          event_data: { error: (error as Error).message },
        });

        failedCount++;
      }

      // Update stats after each batch of 10 emails
      if ((sentCount + failedCount + skippedCount) % 10 === 0) {
        await this.supabase
          .from('campaigns')
          .update({
            stats: {
              ...currentStats,
              sent: currentStats.sent + sentCount,
              failed: currentStats.failed + failedCount,
              unsubscribed: currentStats.unsubscribed + skippedCount,
            },
          })
          .eq('id', campaignId);
      }

      // Rate limiting - Brevo allows ~300 emails/minute on free tier
      await new Promise((resolve) => setTimeout(resolve, 200));
    }

    // Final stats update
    const { data: finalStats } = await this.supabase
      .from('campaign_emails')
      .select('status')
      .eq('campaign_id', campaignId);

    if (finalStats) {
      const sent = finalStats.filter((e) => e.status === 'sent' || e.status === 'delivered' || e.status === 'opened' || e.status === 'clicked').length;
      const failed = finalStats.filter((e) => e.status === 'failed').length;
      const pending = finalStats.filter((e) => e.status === 'pending').length;
      const unsubscribed = finalStats.filter((e) => e.status === 'unsubscribed').length;

      await this.supabase
        .from('campaigns')
        .update({
          stats: {
            ...currentStats,
            total: finalStats.length,
            sent,
            failed,
            unsubscribed,
          },
        })
        .eq('id', campaignId);

      // If no more pending emails, mark campaign as complete
      if (pending === 0) {
        await this.markCampaignComplete(campaignId);
      }
    }

    this.logger.log(
      `Campaign ${campaignId} sending complete: ${sentCount} sent, ${failedCount} failed, ${skippedCount} skipped`,
    );
  }

  private prepareEmailContent(
    campaign: CampaignData,
    email: EmailToSend,
  ): { subject: string; html: string; text: string } {
    const template = campaign.template;
    
    // Debug logging
    this.logger.debug(`Campaign data: ${JSON.stringify({
      id: campaign.id,
      subject_override: campaign.subject_override,
      template_id: campaign.template_id,
      hasTemplate: !!template,
      templateSubject: template?.subject,
    })}`);
    
    if (!template) {
      throw new Error('Template not found');
    }
    
    if (!template.subject && !campaign.subject_override) {
      this.logger.error(`No subject found for campaign ${campaign.id}. Template: ${JSON.stringify(template)}`);
      throw new Error('Subject is required - neither template.subject nor campaign.subject_override is set');
    }

    // Prepare variables for replacement
    const variables: Record<string, string> = {
      firstName: email.csv_contact?.first_name || '',
      lastName: email.csv_contact?.last_name || '',
      email: email.email_address,
      fullName: [email.csv_contact?.first_name, email.csv_contact?.last_name]
        .filter(Boolean)
        .join(' '),
      // Also support snake_case versions from CSV
      first_name: email.csv_contact?.first_name || '',
      last_name: email.csv_contact?.last_name || '',
      ...(email.csv_contact?.custom_fields as Record<string, string> || {}),
    };

    // Replace variables in subject and body
    let subject = campaign.subject_override || template.subject;
    let html = template.body_html || '';
    let text = template.body_text || '';

    for (const [key, value] of Object.entries(variables)) {
      const regex = new RegExp(`\\{\\{${key}\\}\\}`, 'gi');
      subject = subject.replace(regex, value);
      html = html.replace(regex, value);
      text = text.replace(regex, value);
    }

    return { subject, html, text };
  }

  private async markCampaignComplete(campaignId: string): Promise<void> {
    // Final stats calculation
    const { data: emails } = await this.supabase
      .from('campaign_emails')
      .select('status, opened_at, clicked_at, unsubscribed_at')
      .eq('campaign_id', campaignId);

    if (emails) {
      const stats = {
        total: emails.length,
        sent: emails.filter((e) => ['sent', 'delivered', 'opened', 'clicked'].includes(e.status)).length,
        delivered: emails.filter((e) => ['delivered', 'opened', 'clicked'].includes(e.status)).length,
        opened: emails.filter((e) => e.opened_at).length,
        clicked: emails.filter((e) => e.clicked_at).length,
        bounced: emails.filter((e) => e.status === 'bounced').length,
        failed: emails.filter((e) => e.status === 'failed').length,
        unsubscribed: emails.filter((e) => e.status === 'unsubscribed' || e.unsubscribed_at).length,
      };

      await this.supabase
        .from('campaigns')
        .update({
          status: 'sent',
          completed_at: new Date().toISOString(),
          stats,
        })
        .eq('id', campaignId);
    }

    this.logger.log(`Campaign ${campaignId} marked as complete`);
  }
}
