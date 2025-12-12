import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { getSupabaseAdminClient } from '../../config/supabase.config';
import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';

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
  private transporter: Transporter | null = null;

  constructor(private configService: ConfigService) {}

  async onModuleInit() {
    await this.initializeTransporter();
  }

  private async initializeTransporter(): Promise<void> {
    const smtpHost = this.configService.get<string>('SMTP_HOST');
    const smtpPort = this.configService.get<number>('SMTP_PORT') || 587;
    const smtpUser = this.configService.get<string>('SMTP_USER');
    const smtpPass = this.configService.get<string>('SMTP_PASS');
    const smtpSecure = this.configService.get<boolean>('SMTP_SECURE') || false;

    if (!smtpHost || !smtpUser || !smtpPass) {
      this.logger.warn('SMTP configuration not found. Email sending will be simulated.');
      return;
    }

    try {
      this.transporter = nodemailer.createTransport({
        host: smtpHost,
        port: smtpPort,
        secure: smtpSecure, // true for 465, false for other ports
        auth: {
          user: smtpUser,
          pass: smtpPass,
        },
      });

      // Verify connection
      await this.transporter.verify();
      this.logger.log(`SMTP connection established: ${smtpHost}:${smtpPort}`);
    } catch (error) {
      this.logger.error('Failed to initialize SMTP transporter:', error);
      this.transporter = null;
    }
  }

  async startSending(campaignId: string): Promise<void> {
    if (this.activeCampaigns.get(campaignId)) {
      this.logger.warn(`Campaign ${campaignId} is already being sent`);
      return;
    }

    this.activeCampaigns.set(campaignId, true);
    this.logger.log(`Starting email sending for campaign ${campaignId}`);

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
        template:templates(subject, body_html, body_text, variables)
      `)
      .eq('id', campaignId)
      .single();

    if (campaignError || !campaign) {
      throw new Error(`Campaign not found: ${campaignId}`);
    }

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

      try {
        // Prepare email content
        const emailContent = this.prepareEmailContent(campaignData, email);

        // Simulate sending (replace with actual email service)
        await this.sendEmail(emailContent);

        // Update email status
        await this.supabase
          .from('campaign_emails')
          .update({
            status: 'sent',
            sent_at: new Date().toISOString(),
          })
          .eq('id', email.id);

        // Record sent event
        await this.supabase.from('email_events').insert({
          campaign_email_id: email.id,
          event_type: 'sent',
          occurred_at: new Date().toISOString(),
        });

        sentCount++;
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
          metadata: { error: (error as Error).message },
        });

        failedCount++;
      }

      // Update stats after each email
      await this.supabase
        .from('campaigns')
        .update({
          stats: {
            ...currentStats,
            sent: currentStats.sent + sentCount,
            failed: currentStats.failed + failedCount,
          },
        })
        .eq('id', campaignId);

      // Small delay between emails (rate limiting)
      await new Promise((resolve) => setTimeout(resolve, 200));
    }

    // Final stats update
    const { data: finalStats } = await this.supabase
      .from('campaign_emails')
      .select('status')
      .eq('campaign_id', campaignId);

    if (finalStats) {
      const sent = finalStats.filter((e) => e.status === 'sent').length;
      const failed = finalStats.filter((e) => e.status === 'failed').length;
      const pending = finalStats.filter((e) => e.status === 'pending').length;

      await this.supabase
        .from('campaigns')
        .update({
          stats: {
            ...currentStats,
            total: finalStats.length,
            sent,
            failed,
          },
        })
        .eq('id', campaignId);

      // If no more pending emails, mark campaign as complete
      if (pending === 0) {
        await this.markCampaignComplete(campaignId);
      }
    }

    this.logger.log(
      `Campaign ${campaignId} sending complete: ${sentCount} sent, ${failedCount} failed`,
    );
  }

  private prepareEmailContent(
    campaign: CampaignData,
    email: EmailToSend,
  ): { to: string; from: string; replyTo?: string; subject: string; html: string; text: string } {
    const template = campaign.template;
    if (!template) {
      throw new Error('Template not found');
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

    return {
      to: email.email_address,
      from: `${campaign.from_name} <${campaign.from_email}>`,
      replyTo: campaign.reply_to || undefined,
      subject,
      html,
      text,
    };
  }

  private async sendEmail(content: {
    to: string;
    from: string;
    replyTo?: string;
    subject: string;
    html: string;
    text: string;
  }): Promise<void> {
    this.logger.debug(`Sending email to ${content.to}: ${content.subject}`);

    // If no transporter configured, simulate sending
    if (!this.transporter) {
      this.logger.warn(`[SIMULATION] Email would be sent to ${content.to}`);
      await new Promise((resolve) => setTimeout(resolve, 100));
      return;
    }

    // Send real email via Nodemailer
    try {
      const info = await this.transporter.sendMail({
        from: content.from,
        to: content.to,
        replyTo: content.replyTo,
        subject: content.subject,
        html: content.html,
        text: content.text,
      });

      this.logger.log(`Email sent successfully to ${content.to} - MessageId: ${info.messageId}`);
    } catch (error) {
      this.logger.error(`Failed to send email to ${content.to}:`, error);
      throw error;
    }
  }

  private async simulateOpen(emailId: string): Promise<void> {
    // Simulate email being opened
    await this.supabase
      .from('campaign_emails')
      .update({ opened_at: new Date().toISOString() })
      .eq('id', emailId);

    await this.supabase.from('email_events').insert({
      campaign_email_id: emailId,
      event_type: 'opened',
      occurred_at: new Date().toISOString(),
    });

    // Update campaign stats
    const { data: email } = await this.supabase
      .from('campaign_emails')
      .select('campaign_id')
      .eq('id', emailId)
      .single();

    if (email) {
      const { data: stats } = await this.supabase
        .from('campaign_emails')
        .select('opened_at')
        .eq('campaign_id', email.campaign_id)
        .not('opened_at', 'is', null);

      if (stats) {
        const { data: campaign } = await this.supabase
          .from('campaigns')
          .select('stats')
          .eq('id', email.campaign_id)
          .single();

        if (campaign?.stats) {
          await this.supabase
            .from('campaigns')
            .update({
              stats: { ...campaign.stats, opened: stats.length },
            })
            .eq('id', email.campaign_id);
        }
      }
    }

    // Simulate click (30% chance if opened)
    if (Math.random() > 0.7) {
      setTimeout(() => this.simulateClick(emailId), Math.random() * 5000);
    }
  }

  private async simulateClick(emailId: string): Promise<void> {
    await this.supabase
      .from('campaign_emails')
      .update({ clicked_at: new Date().toISOString() })
      .eq('id', emailId);

    await this.supabase.from('email_events').insert({
      campaign_email_id: emailId,
      event_type: 'clicked',
      occurred_at: new Date().toISOString(),
    });

    // Update campaign stats
    const { data: email } = await this.supabase
      .from('campaign_emails')
      .select('campaign_id')
      .eq('id', emailId)
      .single();

    if (email) {
      const { data: stats } = await this.supabase
        .from('campaign_emails')
        .select('clicked_at')
        .eq('campaign_id', email.campaign_id)
        .not('clicked_at', 'is', null);

      if (stats) {
        const { data: campaign } = await this.supabase
          .from('campaigns')
          .select('stats')
          .eq('id', email.campaign_id)
          .single();

        if (campaign?.stats) {
          await this.supabase
            .from('campaigns')
            .update({
              stats: { ...campaign.stats, clicked: stats.length },
            })
            .eq('id', email.campaign_id);
        }
      }
    }
  }

  private async markCampaignComplete(campaignId: string): Promise<void> {
    // Final stats calculation
    const { data: emails } = await this.supabase
      .from('campaign_emails')
      .select('status, opened_at, clicked_at')
      .eq('campaign_id', campaignId);

    if (emails) {
      const stats = {
        total: emails.length,
        sent: emails.filter((e) => e.status === 'sent').length,
        delivered: emails.filter((e) => e.status === 'sent').length, // Assume delivered = sent for now
        opened: emails.filter((e) => e.opened_at).length,
        clicked: emails.filter((e) => e.clicked_at).length,
        bounced: 0,
        failed: emails.filter((e) => e.status === 'failed').length,
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
