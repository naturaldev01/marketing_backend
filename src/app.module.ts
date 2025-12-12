import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TemplatesModule } from './modules/templates/templates.module';
import { CampaignsModule } from './modules/campaigns/campaigns.module';
import { CsvFilesModule } from './modules/csv-files/csv-files.module';
import { ReportsModule } from './modules/reports/reports.module';
import { AuthModule } from './modules/auth/auth.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    AuthModule,
    TemplatesModule,
    CampaignsModule,
    CsvFilesModule,
    ReportsModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
