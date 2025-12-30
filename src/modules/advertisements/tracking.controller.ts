import { Controller, Get, Param, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { ApiTags, ApiOperation, ApiExcludeEndpoint } from '@nestjs/swagger';
import { AdvertisementsService } from './advertisements.service';

@ApiTags('Tracking')
@Controller() // Root level - no prefix
export class TrackingController {
  constructor(private readonly adsService: AdvertisementsService) {}

  // Short URL tracking: go.natural.clinic/:code
  @Get(':code')
  @ApiExcludeEndpoint() // Hide from Swagger to avoid confusion
  @ApiOperation({ summary: 'Track click and redirect to destination URL' })
  async trackAndRedirect(
    @Param('code') code: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    // Skip if it looks like an API path or static file
    if (code.startsWith('api') || code.includes('.')) {
      return res.status(404).send('Not found');
    }

    const ad = await this.adsService.findByTrackingCode(code);

    if (!ad) {
      return res.status(404).send(`
        <!DOCTYPE html>
        <html>
          <head><title>Not Found</title></head>
          <body style="font-family: sans-serif; text-align: center; padding: 50px;">
            <h1>Link Not Found</h1>
            <p>This link is no longer active or doesn't exist.</p>
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
}

