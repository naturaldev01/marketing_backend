import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { getSupabaseAdminClient } from '../../config/supabase.config';

interface BrevoSender {
  name: string;
  email: string;
}

interface BrevoRecipient {
  email: string;
  name?: string;
}

interface BrevoEmailParams {
  sender: BrevoSender;
  to: BrevoRecipient[];
  replyTo?: BrevoSender;
  subject: string;
  htmlContent: string;
  textContent?: string;
  tags?: string[];
  headers?: Record<string, string>;
  params?: Record<string, string>;
}

interface BrevoResponse {
  messageId: string;
}

interface BrevoWebhookEvent {
  event: string;
  email: string;
  id?: number;
  date?: string;
  ts?: number;
  'message-id'?: string;
  ts_event?: number;
  subject?: string;
  tag?: string;
  sending_ip?: string;
  ts_epoch?: number;
  link?: string;
  reason?: string;
}

@Injectable()
export class BrevoService implements OnModuleInit {
  private readonly logger = new Logger(BrevoService.name);
  private readonly apiUrl = 'https://api.brevo.com/v3';
  private apiKey: string | undefined;
  private supabase = getSupabaseAdminClient();
  private isConfigured = false;

  constructor(private configService: ConfigService) {}

  async onModuleInit() {
    this.apiKey = this.configService.get<string>('BREVO_API_KEY');
    
    if (!this.apiKey) {
      this.logger.warn('BREVO_API_KEY not configured. Email sending will be simulated.');
      return;
    }

    this.isConfigured = true;
    this.logger.log('Brevo service initialized successfully');
    
    // Verify API key
    try {
      await this.getAccount();
      this.logger.log('Brevo API connection verified');
    } catch (error) {
      this.logger.error('Failed to verify Brevo API connection:', error);
      this.isConfigured = false;
    }
  }

  isReady(): boolean {
    return this.isConfigured;
  }

  private async makeRequest<T>(
    endpoint: string,
    method: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'GET',
    body?: unknown,
  ): Promise<T> {
    if (!this.apiKey) {
      throw new Error('Brevo API key not configured');
    }

    const response = await fetch(`${this.apiUrl}${endpoint}`, {
      method,
      headers: {
        'api-key': this.apiKey,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(
        `Brevo API error: ${response.status} - ${errorData.message || response.statusText}`,
      );
    }

    // Some endpoints return 204 No Content
    if (response.status === 204) {
      return {} as T;
    }

    return response.json();
  }

  async getAccount(): Promise<unknown> {
    return this.makeRequest('/account');
  }

  async sendEmail(params: BrevoEmailParams): Promise<BrevoResponse> {
    if (!this.isConfigured) {
      // Simulate sending when not configured
      this.logger.warn(`[SIMULATION] Would send email to ${params.to[0]?.email}`);
      return { messageId: `simulated-${Date.now()}-${Math.random().toString(36).substr(2, 9)}` };
    }

    const response = await this.makeRequest<BrevoResponse>('/smtp/email', 'POST', params);
    this.logger.log(`Email sent via Brevo: ${response.messageId} to ${params.to[0]?.email}`);
    return response;
  }

  async sendTransactionalEmail(
    to: string,
    toName: string | undefined,
    fromEmail: string,
    fromName: string,
    replyTo: string | undefined,
    subject: string,
    htmlContent: string,
    textContent: string | undefined,
    campaignId: string,
    campaignEmailId: string,
  ): Promise<{ messageId: string; success: boolean }> {
    try {
      // Add unsubscribe link placeholder to HTML content
      const htmlWithUnsubscribe = this.addUnsubscribeLink(htmlContent, campaignEmailId);
      const textWithUnsubscribe = textContent 
        ? this.addUnsubscribeLinkText(textContent, campaignEmailId)
        : undefined;

      const emailParams: BrevoEmailParams = {
        sender: { name: fromName, email: fromEmail },
        to: [{ email: to, name: toName || undefined }],
        subject,
        htmlContent: htmlWithUnsubscribe,
        textContent: textWithUnsubscribe,
        tags: [`campaign:${campaignId}`],
        headers: {
          'X-Campaign-Id': campaignId,
          'X-Campaign-Email-Id': campaignEmailId,
        },
      };

      if (replyTo) {
        emailParams.replyTo = { email: replyTo, name: fromName };
      }

      const response = await this.sendEmail(emailParams);
      
      return { messageId: response.messageId, success: true };
    } catch (error) {
      this.logger.error(`Failed to send email to ${to}:`, error);
      return { messageId: '', success: false };
    }
  }

  private addUnsubscribeLink(html: string, campaignEmailId: string): string {
    // Get the backend URL for unsubscribe
    const backendUrl = this.configService.get<string>('BACKEND_URL') || 'http://localhost:3001';
    const unsubscribeUrl = `${backendUrl}/api/campaigns/unsubscribe/${campaignEmailId}`;
    
    // Check if there's already an unsubscribe placeholder
    if (html.includes('{{unsubscribe_link}}')) {
      return html.replace(/\{\{unsubscribe_link\}\}/g, unsubscribeUrl);
    }

    // If no placeholder, add unsubscribe link before closing body tag
    const unsubscribeHtml = `
      <div style="text-align: center; margin-top: 30px; padding: 20px; border-top: 1px solid #eee; font-size: 12px; color: #666;">
        <p>Bu e-postayı almak istemiyorsanız <a href="${unsubscribeUrl}" style="color: #5B8C51;">buraya tıklayarak</a> aboneliğinizi iptal edebilirsiniz.</p>
        <p>If you no longer wish to receive these emails, <a href="${unsubscribeUrl}" style="color: #5B8C51;">click here to unsubscribe</a>.</p>
      </div>
    `;

    if (html.includes('</body>')) {
      return html.replace('</body>', `${unsubscribeHtml}</body>`);
    }

    return html + unsubscribeHtml;
  }

  private addUnsubscribeLinkText(text: string, campaignEmailId: string): string {
    const backendUrl = this.configService.get<string>('BACKEND_URL') || 'http://localhost:3001';
    const unsubscribeUrl = `${backendUrl}/api/campaigns/unsubscribe/${campaignEmailId}`;

    if (text.includes('{{unsubscribe_link}}')) {
      return text.replace(/\{\{unsubscribe_link\}\}/g, unsubscribeUrl);
    }

    return text + `\n\n---\nAbonelikten çıkmak için: ${unsubscribeUrl}\nTo unsubscribe: ${unsubscribeUrl}`;
  }

  // Process incoming Brevo webhook events
  async processWebhook(event: BrevoWebhookEvent): Promise<void> {
    const messageId = event['message-id'];
    const eventType = event.event?.toLowerCase();

    this.logger.log(`Processing Brevo webhook: ${eventType} for ${event.email}`);

    // Log webhook to database
    await this.supabase.from('brevo_webhooks').insert({
      event_type: eventType,
      message_id: messageId,
      email: event.email,
      payload: event as unknown as Record<string, unknown>,
      processed: false,
    });

    if (!messageId) {
      this.logger.warn('Webhook received without message-id');
      return;
    }

    // Find the campaign email by Brevo message ID
    const { data: campaignEmail, error } = await this.supabase
      .from('campaign_emails')
      .select('id, campaign_id, status')
      .eq('brevo_message_id', messageId)
      .single();

    if (error || !campaignEmail) {
      this.logger.warn(`Campaign email not found for message ID: ${messageId}`);
      
      // Mark webhook as processed with error
      await this.supabase
        .from('brevo_webhooks')
        .update({ processed: true, error_message: 'Campaign email not found' })
        .eq('message_id', messageId);
      return;
    }

    const now = new Date().toISOString();

    switch (eventType) {
      case 'delivered':
        await this.handleDelivered(campaignEmail.id, campaignEmail.campaign_id, now);
        break;
      case 'opened':
      case 'unique_opened':
        await this.handleOpened(campaignEmail.id, campaignEmail.campaign_id, now, event);
        break;
      case 'click':
        await this.handleClicked(campaignEmail.id, campaignEmail.campaign_id, now, event);
        break;
      case 'hard_bounce':
      case 'soft_bounce':
      case 'blocked':
        await this.handleBounced(campaignEmail.id, campaignEmail.campaign_id, now, event);
        break;
      case 'unsubscribed':
        await this.handleUnsubscribed(campaignEmail.id, campaignEmail.campaign_id, event.email, now, event);
        break;
      case 'complaint':
        await this.handleComplaint(campaignEmail.id, campaignEmail.campaign_id, now, event);
        break;
    }

    // Mark webhook as processed
    await this.supabase
      .from('brevo_webhooks')
      .update({ processed: true })
      .eq('message_id', messageId)
      .eq('event_type', eventType);
  }

  private async handleDelivered(emailId: string, campaignId: string, timestamp: string) {
    await this.supabase
      .from('campaign_emails')
      .update({ 
        status: 'delivered',
        delivered_at: timestamp,
      })
      .eq('id', emailId);

    await this.recordEvent(emailId, 'delivered', timestamp);
    await this.updateCampaignStats(campaignId);
  }

  private async handleOpened(
    emailId: string, 
    campaignId: string, 
    timestamp: string,
    event: BrevoWebhookEvent,
  ) {
    // Only update if not already opened (track first open)
    const { data: existing } = await this.supabase
      .from('campaign_emails')
      .select('opened_at')
      .eq('id', emailId)
      .single();

    const updateData: Record<string, unknown> = { status: 'opened' };
    
    if (!existing?.opened_at) {
      updateData.opened_at = timestamp;
    }

    await this.supabase
      .from('campaign_emails')
      .update(updateData)
      .eq('id', emailId);

    await this.recordEvent(emailId, 'opened', timestamp, {
      ip_address: event.sending_ip,
    });
    await this.updateCampaignStats(campaignId);
  }

  private async handleClicked(
    emailId: string,
    campaignId: string,
    timestamp: string,
    event: BrevoWebhookEvent,
  ) {
    const { data: existing } = await this.supabase
      .from('campaign_emails')
      .select('clicked_at')
      .eq('id', emailId)
      .single();

    const updateData: Record<string, unknown> = { status: 'clicked' };
    
    if (!existing?.clicked_at) {
      updateData.clicked_at = timestamp;
    }

    await this.supabase
      .from('campaign_emails')
      .update(updateData)
      .eq('id', emailId);

    await this.recordEvent(emailId, 'clicked', timestamp, {
      ip_address: event.sending_ip,
      link: event.link,
    });
    await this.updateCampaignStats(campaignId);
  }

  private async handleBounced(
    emailId: string,
    campaignId: string,
    timestamp: string,
    event: BrevoWebhookEvent,
  ) {
    await this.supabase
      .from('campaign_emails')
      .update({
        status: 'bounced',
        bounced_at: timestamp,
        error_message: event.reason || `Bounce type: ${event.event}`,
      })
      .eq('id', emailId);

    await this.recordEvent(emailId, 'bounced', timestamp, {
      reason: event.reason,
      bounce_type: event.event,
    });
    await this.updateCampaignStats(campaignId);
  }

  private async handleUnsubscribed(
    emailId: string,
    campaignId: string,
    email: string,
    timestamp: string,
    event: BrevoWebhookEvent,
  ) {
    // Update campaign email
    await this.supabase
      .from('campaign_emails')
      .update({
        status: 'unsubscribed',
        unsubscribed_at: timestamp,
      })
      .eq('id', emailId);

    // Add to unsubscribes table
    await this.supabase.from('unsubscribes').insert({
      email,
      campaign_id: campaignId,
      campaign_email_id: emailId,
      reason: 'Brevo unsubscribe',
      unsubscribed_at: timestamp,
      ip_address: event.sending_ip,
    });

    await this.recordEvent(emailId, 'unsubscribed', timestamp);
    await this.updateCampaignStats(campaignId);
  }

  private async handleComplaint(
    emailId: string,
    campaignId: string,
    timestamp: string,
    event: BrevoWebhookEvent,
  ) {
    await this.supabase
      .from('campaign_emails')
      .update({
        status: 'bounced',
        error_message: 'Spam complaint received',
      })
      .eq('id', emailId);

    await this.recordEvent(emailId, 'complained', timestamp, {
      reason: event.reason,
    });
    await this.updateCampaignStats(campaignId);
  }

  private async recordEvent(
    campaignEmailId: string,
    eventType: string,
    occurredAt: string,
    eventData?: Record<string, unknown>,
  ) {
    await this.supabase.from('email_events').insert({
      campaign_email_id: campaignEmailId,
      event_type: eventType,
      occurred_at: occurredAt,
      event_data: eventData || {},
      ip_address: (eventData?.ip_address as string) || null,
    });
  }

  private async updateCampaignStats(campaignId: string) {
    // Get current email counts
    const { data: emails } = await this.supabase
      .from('campaign_emails')
      .select('status, opened_at, clicked_at, unsubscribed_at')
      .eq('campaign_id', campaignId);

    if (!emails) return;

    const stats = {
      total: emails.length,
      sent: emails.filter(e => ['sent', 'delivered', 'opened', 'clicked'].includes(e.status)).length,
      delivered: emails.filter(e => ['delivered', 'opened', 'clicked'].includes(e.status)).length,
      opened: emails.filter(e => e.opened_at).length,
      clicked: emails.filter(e => e.clicked_at).length,
      bounced: emails.filter(e => e.status === 'bounced').length,
      failed: emails.filter(e => e.status === 'failed').length,
      unsubscribed: emails.filter(e => e.status === 'unsubscribed' || e.unsubscribed_at).length,
    };

    await this.supabase
      .from('campaigns')
      .update({ stats })
      .eq('id', campaignId);
  }

  // Check if email is unsubscribed
  async isUnsubscribed(email: string): Promise<boolean> {
    const { data } = await this.supabase
      .from('unsubscribes')
      .select('id')
      .eq('email', email.toLowerCase())
      .limit(1);

    return (data?.length || 0) > 0;
  }

  // Get unsubscribe statistics
  async getUnsubscribeStats(campaignId?: string) {
    let query = this.supabase
      .from('unsubscribes')
      .select('*', { count: 'exact' });

    if (campaignId) {
      query = query.eq('campaign_id', campaignId);
    }

    const { data, count } = await query.order('unsubscribed_at', { ascending: false });

    return {
      total: count || 0,
      recent: data?.slice(0, 10) || [],
    };
  }
}


