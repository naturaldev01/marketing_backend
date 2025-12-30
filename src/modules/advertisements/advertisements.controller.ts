import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Req,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import type { Request } from 'express';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { AdvertisementsService } from './advertisements.service';
import {
  CreateAdvertisementDto,
  UpdateAdvertisementDto,
} from './dto/advertisement.dto';
import { SupabaseGuard } from '../auth/guards/supabase.guard';

@ApiTags('Advertisements')
@Controller('api')
export class AdvertisementsController {
  constructor(private readonly adsService: AdvertisementsService) {}

  // ============================================
  // PROTECTED ENDPOINTS - CRUD Operations
  // Tracking endpoint is in TrackingController (root level)
  // ============================================

  @Post('advertisements')
  @UseGuards(SupabaseGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a new advertisement' })
  async create(@Body() dto: CreateAdvertisementDto, @Req() req: Request) {
    const user = (req as any).user;
    return this.adsService.create(dto, user.id);
  }

  @Get('advertisements')
  @UseGuards(SupabaseGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get all advertisements' })
  async findAll() {
    return this.adsService.findAll();
  }

  @Get('advertisements/dashboard-stats')
  @UseGuards(SupabaseGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get dashboard statistics for advertisements' })
  async getDashboardStats() {
    return this.adsService.getDashboardStats();
  }

  @Get('advertisements/:id')
  @UseGuards(SupabaseGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get advertisement by ID' })
  async findOne(@Param('id') id: string) {
    return this.adsService.findOne(id);
  }

  @Get('advertisements/:id/stats')
  @UseGuards(SupabaseGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get detailed statistics for an advertisement' })
  @ApiQuery({ name: 'days', required: false, description: 'Number of days to include (default: 30)' })
  async getStats(@Param('id') id: string, @Query('days') days?: string) {
    const numDays = days ? parseInt(days, 10) : 30;
    return this.adsService.getStats(id, numDays);
  }

  @Put('advertisements/:id')
  @UseGuards(SupabaseGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update an advertisement' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateAdvertisementDto,
  ) {
    return this.adsService.update(id, dto);
  }

  @Delete('advertisements/:id')
  @UseGuards(SupabaseGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete an advertisement' })
  async delete(@Param('id') id: string) {
    return this.adsService.delete(id);
  }
}

