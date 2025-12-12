import {
  Controller,
  Post,
  Body,
  Get,
  Param,
  Res,
  Query,
  Logger,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiExcludeEndpoint } from '@nestjs/swagger';
import type { Response } from 'express';
import { BrevoService } from './brevo.service';
import { SupabaseGuard } from '../auth/guards/supabase.guard';
import { getSupabaseAdminClient } from '../../config/supabase.config';
import { ConfigService } from '@nestjs/config';

interface BrevoWebhookPayload {
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

@ApiTags('Brevo Webhooks')
@Controller('api/brevo')
export class BrevoWebhookController {
  private readonly logger = new Logger(BrevoWebhookController.name);
  private supabase = getSupabaseAdminClient();

  constructor(
    private readonly brevoService: BrevoService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Brevo webhook endpoint - receives events from Brevo
   * This endpoint is called by Brevo when email events occur
   */
  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  @ApiExcludeEndpoint() // Hide from Swagger as it's for Brevo
  async handleWebhook(@Body() payload: BrevoWebhookPayload): Promise<{ success: boolean }> {
    this.logger.log(`Received Brevo webhook: ${payload.event} for ${payload.email}`);

    try {
      await this.brevoService.processWebhook(payload);
      return { success: true };
    } catch (error) {
      this.logger.error('Error processing Brevo webhook:', error);
      // Return success anyway to prevent Brevo from retrying
      return { success: true };
    }
  }

  /**
   * Bulk webhook handler for multiple events
   */
  @Post('webhooks/bulk')
  @HttpCode(HttpStatus.OK)
  @ApiExcludeEndpoint()
  async handleBulkWebhook(@Body() payloads: BrevoWebhookPayload[]): Promise<{ success: boolean; processed: number }> {
    this.logger.log(`Received bulk Brevo webhook with ${payloads.length} events`);

    let processed = 0;
    for (const payload of payloads) {
      try {
        await this.brevoService.processWebhook(payload);
        processed++;
      } catch (error) {
        this.logger.error(`Error processing webhook for ${payload.email}:`, error);
      }
    }

    return { success: true, processed };
  }

  /**
   * Get webhook logs - for debugging
   */
  @Get('webhooks/logs')
  @UseGuards(SupabaseGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get Brevo webhook logs' })
  async getWebhookLogs(
    @Query('limit') limit?: string,
    @Query('eventType') eventType?: string,
  ) {
    let query = this.supabase
      .from('brevo_webhooks')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(parseInt(limit || '50', 10));

    if (eventType) {
      query = query.eq('event_type', eventType);
    }

    const { data, error } = await query;

    if (error) throw error;
    return data;
  }

  /**
   * Get unsubscribe statistics
   */
  @Get('unsubscribes')
  @UseGuards(SupabaseGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get unsubscribe statistics' })
  async getUnsubscribeStats(@Query('campaignId') campaignId?: string) {
    return this.brevoService.getUnsubscribeStats(campaignId);
  }

  /**
   * Get unsubscribe list
   */
  @Get('unsubscribes/list')
  @UseGuards(SupabaseGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get list of unsubscribed emails' })
  async getUnsubscribeList(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('campaignId') campaignId?: string,
  ) {
    const pageNum = parseInt(page || '1', 10);
    const limitNum = parseInt(limit || '50', 10);
    const offset = (pageNum - 1) * limitNum;

    let query = this.supabase
      .from('unsubscribes')
      .select('*, campaign:campaigns(id, name)', { count: 'exact' })
      .order('unsubscribed_at', { ascending: false })
      .range(offset, offset + limitNum - 1);

    if (campaignId) {
      query = query.eq('campaign_id', campaignId);
    }

    const { data, error, count } = await query;

    if (error) throw error;

    return {
      data,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total: count,
        totalPages: Math.ceil((count || 0) / limitNum),
      },
    };
  }

  /**
   * Check if an email is unsubscribed
   */
  @Get('unsubscribes/check/:email')
  @UseGuards(SupabaseGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Check if an email is unsubscribed' })
  async checkUnsubscribed(@Param('email') email: string) {
    const isUnsubscribed = await this.brevoService.isUnsubscribed(email);
    return { email, isUnsubscribed };
  }
}

/**
 * Public controller for unsubscribe page - no auth required
 */
@Controller('api/campaigns')
export class UnsubscribeController {
  private readonly logger = new Logger(UnsubscribeController.name);
  private supabase = getSupabaseAdminClient();

  constructor(private readonly configService: ConfigService) {}

  /**
   * Handle unsubscribe link click
   * This is a public endpoint that users click from their emails
   */
  @Get('unsubscribe/:campaignEmailId')
  @ApiOperation({ summary: 'Unsubscribe from email list' })
  async unsubscribe(
    @Param('campaignEmailId') campaignEmailId: string,
    @Res() res: Response,
  ) {
    this.logger.log(`Unsubscribe request for campaign email: ${campaignEmailId}`);

    try {
      // Get the campaign email
      const { data: campaignEmail, error } = await this.supabase
        .from('campaign_emails')
        .select('id, email_address, campaign_id, status, unsubscribed_at')
        .eq('id', campaignEmailId)
        .single();

      if (error || !campaignEmail) {
        return res.status(404).send(this.getUnsubscribeHtml(false, 'Link geçersiz veya süresi dolmuş.'));
      }

      // Check if already unsubscribed
      if (campaignEmail.unsubscribed_at || campaignEmail.status === 'unsubscribed') {
        return res.send(this.getUnsubscribeHtml(true, 'Zaten abonelikten çıkmışsınız.'));
      }

      const now = new Date().toISOString();

      // Update campaign email
      await this.supabase
        .from('campaign_emails')
        .update({
          status: 'unsubscribed',
          unsubscribed_at: now,
        })
        .eq('id', campaignEmailId);

      // Add to unsubscribes table
      await this.supabase.from('unsubscribes').insert({
        email: campaignEmail.email_address,
        campaign_id: campaignEmail.campaign_id,
        campaign_email_id: campaignEmailId,
        reason: 'User clicked unsubscribe link',
        unsubscribed_at: now,
      });

      // Record event
      await this.supabase.from('email_events').insert({
        campaign_email_id: campaignEmailId,
        event_type: 'unsubscribed',
        occurred_at: now,
        event_data: { source: 'unsubscribe_link' },
      });

      // Update campaign stats
      const { data: emails } = await this.supabase
        .from('campaign_emails')
        .select('status, unsubscribed_at')
        .eq('campaign_id', campaignEmail.campaign_id);

      if (emails) {
        const { data: campaign } = await this.supabase
          .from('campaigns')
          .select('stats')
          .eq('id', campaignEmail.campaign_id)
          .single();

        if (campaign?.stats) {
          const unsubscribedCount = emails.filter(e => e.status === 'unsubscribed' || e.unsubscribed_at).length;
          
          await this.supabase
            .from('campaigns')
            .update({
              stats: { ...campaign.stats, unsubscribed: unsubscribedCount },
            })
            .eq('id', campaignEmail.campaign_id);
        }
      }

      return res.send(this.getUnsubscribeHtml(true));
    } catch (error) {
      this.logger.error('Error processing unsubscribe:', error);
      return res.status(500).send(this.getUnsubscribeHtml(false, 'Bir hata oluştu. Lütfen tekrar deneyin.'));
    }
  }

  private getUnsubscribeHtml(success: boolean, message?: string): string {
    const defaultMessage = success
      ? 'Abonelikten başarıyla çıktınız. Artık bu kampanyadan e-posta almayacaksınız.'
      : 'Abonelikten çıkarken bir hata oluştu.';

    return `
<!DOCTYPE html>
<html lang="tr">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${success ? 'Abonelikten Çıkıldı' : 'Hata'}</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
            background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 20px;
        }
        .container {
            background: #1e293b;
            border-radius: 16px;
            padding: 48px;
            max-width: 480px;
            width: 100%;
            text-align: center;
            box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
            border: 1px solid #334155;
        }
        .icon {
            width: 80px;
            height: 80px;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            margin: 0 auto 24px;
            font-size: 40px;
        }
        .icon.success {
            background: rgba(91, 140, 81, 0.2);
        }
        .icon.error {
            background: rgba(239, 68, 68, 0.2);
        }
        h1 {
            color: #f8fafc;
            font-size: 24px;
            margin-bottom: 16px;
        }
        p {
            color: #94a3b8;
            font-size: 16px;
            line-height: 1.6;
        }
        .logo {
            margin-top: 32px;
            color: #5B8C51;
            font-weight: bold;
            font-size: 14px;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="icon ${success ? 'success' : 'error'}">
            ${success ? '✓' : '✕'}
        </div>
        <h1>${success ? 'Abonelikten Çıkıldı' : 'Hata'}</h1>
        <p>${message || defaultMessage}</p>
        <div class="logo">Natural Clinic Marketing</div>
    </div>
</body>
</html>
    `;
  }
}

