import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { CampaignsService } from './campaigns.service';
import { CampaignsController } from './campaigns.controller';
import { EmailSenderService } from './email-sender.service';
import { CampaignSchedulerService } from './campaign-scheduler.service';
import { BrevoService } from './brevo.service';
import { BrevoWebhookController, UnsubscribeController } from './brevo-webhook.controller';
import { AuthModule } from '../auth/auth.module';
import { TemplatesModule } from '../templates/templates.module';
import { CsvFilesModule } from '../csv-files/csv-files.module';

@Module({
  imports: [ConfigModule, AuthModule, TemplatesModule, CsvFilesModule],
  controllers: [CampaignsController, BrevoWebhookController, UnsubscribeController],
  providers: [CampaignsService, EmailSenderService, CampaignSchedulerService, BrevoService],
  exports: [CampaignsService, CampaignSchedulerService, BrevoService],
})
export class CampaignsModule {}
