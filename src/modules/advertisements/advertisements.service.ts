import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { getSupabaseAdminClient } from '../../config/supabase.config';
import { CreateAdvertisementDto, UpdateAdvertisementDto } from './dto/advertisement.dto';
import { randomBytes } from 'crypto';

// Generate a short, URL-safe tracking code (6 characters)
function generateTrackingCode(length: number = 6): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = randomBytes(length);
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars[bytes[i] % chars.length];
  }
  return result;
}

@Injectable()
export class AdvertisementsService {
  private readonly logger = new Logger(AdvertisementsService.name);
  private supabase = getSupabaseAdminClient();

  async create(dto: CreateAdvertisementDto, userId: string) {
    const tracking_code = generateTrackingCode();

    const { data, error } = await this.supabase
      .from('advertisements')
      .insert({
        ...dto,
        tracking_code,
        created_by: userId,
      })
      .select()
      .single();

    if (error) {
      this.logger.error('Failed to create advertisement', error);
      throw error;
    }

    return data;
  }

  async findAll() {
    const { data, error } = await this.supabase
      .from('advertisements')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      this.logger.error('Failed to fetch advertisements', error);
      throw error;
    }

    return data;
  }

  async findOne(id: string) {
    const { data, error } = await this.supabase
      .from('advertisements')
      .select('*')
      .eq('id', id)
      .single();

    if (error || !data) {
      throw new NotFoundException('Advertisement not found');
    }

    return data;
  }

  async findByTrackingCode(code: string) {
    const { data, error } = await this.supabase
      .from('advertisements')
      .select('*')
      .eq('tracking_code', code)
      .eq('is_active', true)
      .single();

    if (error || !data) {
      return null;
    }

    return data;
  }

  async update(id: string, dto: UpdateAdvertisementDto) {
    const { data, error } = await this.supabase
      .from('advertisements')
      .update({ ...dto, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      this.logger.error('Failed to update advertisement', error);
      throw error;
    }

    return data;
  }

  async delete(id: string) {
    const { error } = await this.supabase
      .from('advertisements')
      .delete()
      .eq('id', id);

    if (error) {
      this.logger.error('Failed to delete advertisement', error);
      throw error;
    }

    return { success: true };
  }

  async recordClick(
    advertisementId: string,
    clickData: {
      ip_address?: string;
      user_agent?: string;
      referrer?: string;
    },
  ) {
    try {
      // Parse user agent for device info
      const deviceInfo = this.parseUserAgent(clickData.user_agent || '');

      // Record click
      await this.supabase.from('ad_clicks').insert({
        advertisement_id: advertisementId,
        ip_address: clickData.ip_address,
        user_agent: clickData.user_agent,
        referrer: clickData.referrer,
        device_type: deviceInfo.device,
        browser: deviceInfo.browser,
        os: deviceInfo.os,
      });

      // Get current stats
      const { data: ad } = await this.supabase
        .from('advertisements')
        .select('stats')
        .eq('id', advertisementId)
        .single();

      const currentStats = (ad?.stats as { clicks: number; unique_clicks: number }) || {
        clicks: 0,
        unique_clicks: 0,
      };

      // Check if unique click (by IP in last 24h)
      const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const { count } = await this.supabase
        .from('ad_clicks')
        .select('*', { count: 'exact', head: true })
        .eq('advertisement_id', advertisementId)
        .eq('ip_address', clickData.ip_address)
        .gte('clicked_at', twentyFourHoursAgo);

      const isUnique = (count || 0) <= 1;

      // Update stats
      await this.supabase
        .from('advertisements')
        .update({
          stats: {
            clicks: currentStats.clicks + 1,
            unique_clicks: currentStats.unique_clicks + (isUnique ? 1 : 0),
          },
        })
        .eq('id', advertisementId);

      this.logger.log(`Recorded click for ad ${advertisementId}, unique: ${isUnique}`);
    } catch (error) {
      this.logger.error('Failed to record click', error);
      // Don't throw - we don't want to fail the redirect
    }
  }

  async getStats(id: string, days: number = 30) {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    // Get advertisement details
    const ad = await this.findOne(id);

    // Get all clicks within timeframe
    const { data: clicks } = await this.supabase
      .from('ad_clicks')
      .select('clicked_at, device_type, browser, os, country')
      .eq('advertisement_id', id)
      .gte('clicked_at', startDate.toISOString())
      .order('clicked_at', { ascending: true });

    // Group by day
    const dailyStats = this.groupByDay(clicks || []);

    // Device breakdown
    const deviceBreakdown = this.groupBy(clicks || [], 'device_type');

    // Browser breakdown
    const browserBreakdown = this.groupBy(clicks || [], 'browser');

    // OS breakdown
    const osBreakdown = this.groupBy(clicks || [], 'os');

    // Hourly distribution (for best time to post analysis)
    const hourlyDistribution = this.groupByHour(clicks || []);

    return {
      advertisement: ad,
      dailyStats,
      deviceBreakdown,
      browserBreakdown,
      osBreakdown,
      hourlyDistribution,
      totalClicks: clicks?.length || 0,
      periodDays: days,
    };
  }

  async getDashboardStats() {
    // Get total advertisements
    const { count: totalAds } = await this.supabase
      .from('advertisements')
      .select('*', { count: 'exact', head: true });

    // Get active advertisements
    const { count: activeAds } = await this.supabase
      .from('advertisements')
      .select('*', { count: 'exact', head: true })
      .eq('is_active', true);

    // Get total clicks (last 30 days)
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const { count: totalClicks } = await this.supabase
      .from('ad_clicks')
      .select('*', { count: 'exact', head: true })
      .gte('clicked_at', thirtyDaysAgo);

    // Get top performing ads
    const { data: topAds } = await this.supabase
      .from('advertisements')
      .select('id, name, stats, platform')
      .eq('is_active', true)
      .order('stats->clicks', { ascending: false })
      .limit(5);

    return {
      totalAds: totalAds || 0,
      activeAds: activeAds || 0,
      totalClicks: totalClicks || 0,
      topAds: topAds || [],
    };
  }

  private parseUserAgent(ua: string) {
    const isMobile = /mobile|android|iphone|ipod/i.test(ua);
    const isTablet = /tablet|ipad/i.test(ua);

    let browser = 'Other';
    if (ua.includes('Chrome') && !ua.includes('Edg')) browser = 'Chrome';
    else if (ua.includes('Firefox')) browser = 'Firefox';
    else if (ua.includes('Safari') && !ua.includes('Chrome')) browser = 'Safari';
    else if (ua.includes('Edg')) browser = 'Edge';
    else if (ua.includes('Opera') || ua.includes('OPR')) browser = 'Opera';

    let os = 'Other';
    if (ua.includes('Windows')) os = 'Windows';
    else if (ua.includes('Mac OS')) os = 'macOS';
    else if (ua.includes('Linux') && !ua.includes('Android')) os = 'Linux';
    else if (ua.includes('Android')) os = 'Android';
    else if (ua.includes('iPhone') || ua.includes('iPad')) os = 'iOS';

    return {
      device: isTablet ? 'Tablet' : isMobile ? 'Mobile' : 'Desktop',
      browser,
      os,
    };
  }

  private groupByDay(clicks: { clicked_at: string }[]) {
    const groups: Record<string, number> = {};
    clicks.forEach((click) => {
      const day = click.clicked_at.split('T')[0];
      groups[day] = (groups[day] || 0) + 1;
    });
    return Object.entries(groups)
      .map(([date, count]) => ({ date, count }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }

  private groupByHour(clicks: { clicked_at: string }[]) {
    const hours = Array.from({ length: 24 }, (_, i) => ({ hour: i, count: 0 }));
    clicks.forEach((click) => {
      const hour = new Date(click.clicked_at).getHours();
      hours[hour].count++;
    });
    return hours;
  }

  private groupBy(items: Record<string, unknown>[], key: string) {
    const groups: Record<string, number> = {};
    items.forEach((item) => {
      const value = (item[key] as string) || 'Unknown';
      groups[value] = (groups[value] || 0) + 1;
    });
    return Object.entries(groups)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);
  }
}

