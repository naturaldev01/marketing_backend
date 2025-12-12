import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { ReportsService } from './reports.service';
import { SupabaseGuard } from '../auth/guards/supabase.guard';

@ApiTags('Reports')
@Controller('api/reports')
@UseGuards(SupabaseGuard)
@ApiBearerAuth()
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Get('dashboard')
  @ApiOperation({ summary: 'Get dashboard statistics' })
  getDashboardStats() {
    return this.reportsService.getDashboardStats();
  }

  @Get('email-performance')
  @ApiOperation({ summary: 'Get email performance data for chart' })
  @ApiQuery({ name: 'days', required: false, type: Number, description: 'Number of days (default: 7)' })
  getEmailPerformance(@Query('days') days?: string) {
    return this.reportsService.getEmailPerformance(days ? parseInt(days, 10) : 7);
  }

  @Get('campaigns/:id')
  @ApiOperation({ summary: 'Get detailed campaign report' })
  getCampaignReport(@Param('id') id: string) {
    return this.reportsService.getCampaignReport(id);
  }

  @Get('activity')
  @ApiOperation({ summary: 'Get recent email activity' })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  getRecentActivity(@Query('limit') limit?: string) {
    return this.reportsService.getRecentActivity(limit ? parseInt(limit, 10) : undefined);
  }

  @Get('emails/:id')
  @ApiOperation({ summary: 'Get detailed email report' })
  getEmailDetails(@Param('id') id: string) {
    return this.reportsService.getEmailDetails(id);
  }

  @Get('compare')
  @ApiOperation({ summary: 'Compare multiple campaigns' })
  @ApiQuery({ name: 'ids', required: true, type: String, description: 'Comma-separated campaign IDs' })
  getCampaignComparison(@Query('ids') ids: string) {
    const campaignIds = ids.split(',').map((id) => id.trim());
    return this.reportsService.getCampaignComparison(campaignIds);
  }

  @Get('campaigns/:id/export')
  @ApiOperation({ summary: 'Export campaign report data' })
  exportCampaignReport(@Param('id') id: string) {
    return this.reportsService.exportCampaignReport(id);
  }
}

