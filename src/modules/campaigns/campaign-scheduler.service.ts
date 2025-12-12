import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { getSupabaseAdminClient } from '../../config/supabase.config';
import { EmailSenderService } from './email-sender.service';

@Injectable()
export class CampaignSchedulerService implements OnModuleInit {
  private readonly logger = new Logger(CampaignSchedulerService.name);
  private supabase = getSupabaseAdminClient();
  private schedulerInterval: NodeJS.Timeout | null = null;

  constructor(private emailSenderService: EmailSenderService) {}

  onModuleInit() {
    this.startScheduler();
    this.logger.log('Campaign scheduler initialized');
  }

  private startScheduler(): void {
    // Check for scheduled campaigns every minute
    this.schedulerInterval = setInterval(() => {
      this.checkScheduledCampaigns().catch((error) => {
        this.logger.error('Error checking scheduled campaigns:', error);
      });
    }, 60000); // Check every minute

    // Also check immediately on startup
    this.checkScheduledCampaigns().catch((error) => {
      this.logger.error('Error checking scheduled campaigns on startup:', error);
    });
  }

  private async checkScheduledCampaigns(): Promise<void> {
    const now = new Date();
    
    // Find campaigns that are scheduled and their time has come
    const { data: campaigns, error } = await this.supabase
      .from('campaigns')
      .select('id, name, scheduled_at, send_options')
      .eq('status', 'scheduled')
      .lte('scheduled_at', now.toISOString());

    if (error) {
      this.logger.error('Error fetching scheduled campaigns:', error);
      return;
    }

    if (!campaigns || campaigns.length === 0) {
      return;
    }

    this.logger.log(`Found ${campaigns.length} campaigns ready to send`);

    for (const campaign of campaigns) {
      try {
        this.logger.log(`Starting scheduled campaign: ${campaign.name} (${campaign.id})`);

        // Update status to sending
        const { error: updateError } = await this.supabase
          .from('campaigns')
          .update({
            status: 'sending',
            started_at: new Date().toISOString(),
          })
          .eq('id', campaign.id)
          .eq('status', 'scheduled'); // Ensure it's still scheduled (prevent race conditions)

        if (updateError) {
          this.logger.error(`Error updating campaign ${campaign.id}:`, updateError);
          continue;
        }

        // Start sending emails
        this.emailSenderService.startSending(campaign.id).catch((error) => {
          this.logger.error(`Error starting email sender for campaign ${campaign.id}:`, error);
        });
      } catch (error) {
        this.logger.error(`Error processing scheduled campaign ${campaign.id}:`, error);
      }
    }
  }

  async scheduleNow(campaignId: string): Promise<void> {
    this.logger.log(`Manually starting campaign: ${campaignId}`);
    
    // Start sending immediately
    this.emailSenderService.startSending(campaignId).catch((error) => {
      this.logger.error(`Error starting email sender for campaign ${campaignId}:`, error);
    });
  }

  async stopCampaign(campaignId: string): Promise<void> {
    this.logger.log(`Stopping campaign: ${campaignId}`);
    await this.emailSenderService.stopSending(campaignId);
  }

  onModuleDestroy() {
    if (this.schedulerInterval) {
      clearInterval(this.schedulerInterval);
      this.logger.log('Campaign scheduler stopped');
    }
  }
}
