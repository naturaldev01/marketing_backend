import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { CampaignsService } from './campaigns.service';
import { CampaignsController } from './campaigns.controller';
import { EmailSenderService } from './email-sender.service';
import { CampaignSchedulerService } from './campaign-scheduler.service';
import { AuthModule } from '../auth/auth.module';
import { TemplatesModule } from '../templates/templates.module';
import { CsvFilesModule } from '../csv-files/csv-files.module';

@Module({
  imports: [ConfigModule, AuthModule, TemplatesModule, CsvFilesModule],
  controllers: [CampaignsController],
  providers: [CampaignsService, EmailSenderService, CampaignSchedulerService],
  exports: [CampaignsService, CampaignSchedulerService],
})
export class CampaignsModule {}

