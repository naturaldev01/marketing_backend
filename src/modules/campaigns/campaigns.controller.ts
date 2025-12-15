import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  Req,
  Query,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { CampaignsService } from './campaigns.service';
import { CreateCampaignDto, UpdateCampaignDto, ScheduleCampaignDto } from './dto/campaign.dto';
import { SupabaseGuard } from '../auth/guards/supabase.guard';

@ApiTags('Campaigns')
@Controller('api/campaigns')
@UseGuards(SupabaseGuard)
@ApiBearerAuth()
export class CampaignsController {
  constructor(private readonly campaignsService: CampaignsService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new campaign' })
  create(@Body() createCampaignDto: CreateCampaignDto, @Req() req: any) {
    return this.campaignsService.create(createCampaignDto, req.user.id);
  }

  @Get()
  @ApiOperation({ summary: 'Get all campaigns' })
  @ApiQuery({ name: 'status', required: false, enum: ['draft', 'scheduled', 'sending', 'sent', 'paused', 'cancelled'] })
  @ApiQuery({ name: 'search', required: false, type: String })
  findAll(
    @Query('status') status?: string,
    @Query('search') search?: string,
  ) {
    return this.campaignsService.findAll({ status, search });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a campaign by ID' })
  findOne(@Param('id') id: string) {
    return this.campaignsService.findOne(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a campaign' })
  update(@Param('id') id: string, @Body() updateCampaignDto: UpdateCampaignDto) {
    return this.campaignsService.update(id, updateCampaignDto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a campaign' })
  remove(@Param('id') id: string) {
    return this.campaignsService.remove(id);
  }

  @Post(':id/schedule')
  @ApiOperation({ summary: 'Schedule a campaign for a specific date/time' })
  schedule(@Param('id') id: string, @Body() dto: ScheduleCampaignDto) {
    return this.campaignsService.schedule(id, new Date(dto.scheduledAt), dto.timezone);
  }

  @Post(':id/start')
  @ApiOperation({ summary: 'Start sending a campaign immediately' })
  start(@Param('id') id: string) {
    return this.campaignsService.start(id);
  }

  @Post(':id/pause')
  @ApiOperation({ summary: 'Pause a sending campaign' })
  pause(@Param('id') id: string) {
    return this.campaignsService.pause(id);
  }

  @Post(':id/cancel')
  @ApiOperation({ summary: 'Cancel a campaign' })
  cancel(@Param('id') id: string) {
    return this.campaignsService.cancel(id);
  }

  @Post(':id/duplicate')
  @ApiOperation({ summary: 'Duplicate a campaign' })
  duplicate(@Param('id') id: string, @Req() req: any) {
    return this.campaignsService.duplicate(id, req.user.id);
  }

  @Get('hello')
  getHello() : string {
    return "Hello World";
  }

  @Get(':id/emails')
  @ApiOperation({ summary: 'Get campaign emails' })
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  getCampaignEmails(
    @Param('id') id: string,
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.campaignsService.getCampaignEmails(id, {
      status,
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }
}

