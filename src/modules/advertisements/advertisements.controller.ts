import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Req,
  Res,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import type { Request, Response } from 'express';
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
  // PUBLIC ENDPOINT - Track click and redirect
  // ============================================
  @Get('g/:code')
  @ApiOperation({ summary: 'Track click and redirect to destination URL' })
  async trackAndRedirect(
    @Param('code') code: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const ad = await this.adsService.findByTrackingCode(code);

    if (!ad) {
      return res.status(404).send(`
        <!DOCTYPE html>
        <html>
          <head><title>Not Found</title></head>
          <body style="font-family: sans-serif; text-align: center; padding: 50px;">
            <h1>Link Not Found</h1>
            <p>This advertisement link is no longer active or doesn't exist.</p>
          </body>
        </html>
      `);
    }

    // Build destination URL with UTM parameters
    let destinationUrl = ad.destination_url;
    const utmParams = new URLSearchParams();

    if (ad.utm_source) utmParams.append('utm_source', ad.utm_source);
    if (ad.utm_medium) utmParams.append('utm_medium', ad.utm_medium);
    if (ad.utm_campaign) utmParams.append('utm_campaign', ad.utm_campaign);

    if (utmParams.toString()) {
      const separator = destinationUrl.includes('?') ? '&' : '?';
      destinationUrl += separator + utmParams.toString();
    }

    // Record click asynchronously (don't await)
    const forwardedFor = req.headers['x-forwarded-for'];
    const ipAddress =
      typeof forwardedFor === 'string'
        ? forwardedFor.split(',')[0].trim()
        : req.ip;

    this.adsService.recordClick(ad.id, {
      ip_address: ipAddress,
      user_agent: req.headers['user-agent'],
      referrer: req.headers['referer'],
    });

    // Redirect to destination
    return res.redirect(302, destinationUrl);
  }

  // ============================================
  // PROTECTED ENDPOINTS - CRUD Operations
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

