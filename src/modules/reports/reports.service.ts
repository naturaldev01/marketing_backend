import { Injectable } from '@nestjs/common';
import { getSupabaseAdminClient } from '../../config/supabase.config';

@Injectable()
export class ReportsService {
  private supabase = getSupabaseAdminClient();

  async getDashboardStats() {
    // Calculate date ranges for week comparison
    const now = new Date();
    const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const twoWeeksAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);

    // Get all campaigns with created_at for week comparison
    const { data: campaigns } = await this.supabase
      .from('campaigns')
      .select('status, created_at');

    const campaignStats = {
      total: campaigns?.length || 0,
      draft: campaigns?.filter((c) => c.status === 'draft').length || 0,
      scheduled: campaigns?.filter((c) => c.status === 'scheduled').length || 0,
      sending: campaigns?.filter((c) => c.status === 'sending').length || 0,
      sent: campaigns?.filter((c) => c.status === 'sent').length || 0,
      paused: campaigns?.filter((c) => c.status === 'paused').length || 0,
      cancelled: campaigns?.filter((c) => c.status === 'cancelled').length || 0,
    };

    // Calculate campaigns created this week vs last week
    const campaignsThisWeek = campaigns?.filter(
      (c) => new Date(c.created_at) >= oneWeekAgo,
    ).length || 0;
    const campaignsLastWeek = campaigns?.filter(
      (c) => new Date(c.created_at) >= twoWeeksAgo && new Date(c.created_at) < oneWeekAgo,
    ).length || 0;

    // Get templates with created_at
    const { data: templates } = await this.supabase
      .from('templates')
      .select('created_at');

    const templateCount = templates?.length || 0;
    const templatesThisWeek = templates?.filter(
      (t) => new Date(t.created_at) >= oneWeekAgo,
    ).length || 0;
    const templatesLastWeek = templates?.filter(
      (t) => new Date(t.created_at) >= twoWeeksAgo && new Date(t.created_at) < oneWeekAgo,
    ).length || 0;

    // Get CSV files with created_at
    const { data: csvFiles } = await this.supabase
      .from('csv_files')
      .select('created_at');

    const csvFileCount = csvFiles?.length || 0;
    const csvFilesThisWeek = csvFiles?.filter(
      (f) => new Date(f.created_at) >= oneWeekAgo,
    ).length || 0;
    const csvFilesLastWeek = csvFiles?.filter(
      (f) => new Date(f.created_at) >= twoWeeksAgo && new Date(f.created_at) < oneWeekAgo,
    ).length || 0;

    // Get contacts with created_at
    const { data: contacts } = await this.supabase
      .from('csv_contacts')
      .select('created_at')
      .eq('is_valid', true);

    const contactCount = contacts?.length || 0;
    const contactsThisWeek = contacts?.filter(
      (c) => new Date(c.created_at) >= oneWeekAgo,
    ).length || 0;
    const contactsLastWeek = contacts?.filter(
      (c) => new Date(c.created_at) >= twoWeeksAgo && new Date(c.created_at) < oneWeekAgo,
    ).length || 0;

    // Get email stats
    const { data: emailStats } = await this.supabase
      .from('campaign_emails')
      .select('status');

    const emailCounts = {
      total: emailStats?.length || 0,
      pending: emailStats?.filter((e) => e.status === 'pending').length || 0,
      sent: emailStats?.filter((e) => e.status === 'sent').length || 0,
      delivered: emailStats?.filter((e) => e.status === 'delivered').length || 0,
      opened: emailStats?.filter((e) => e.status === 'opened').length || 0,
      clicked: emailStats?.filter((e) => e.status === 'clicked').length || 0,
      bounced: emailStats?.filter((e) => e.status === 'bounced').length || 0,
      failed: emailStats?.filter((e) => e.status === 'failed').length || 0,
    };

    // Calculate percentage changes
    const calculateChange = (current: number, previous: number): number => {
      if (previous === 0) return current > 0 ? 100 : 0;
      return Math.round(((current - previous) / previous) * 100);
    };

    return {
      campaigns: campaignStats,
      templates: templateCount,
      csvFiles: csvFileCount,
      contacts: contactCount,
      emails: emailCounts,
      weeklyChanges: {
        campaigns: calculateChange(campaignsThisWeek, campaignsLastWeek),
        templates: calculateChange(templatesThisWeek, templatesLastWeek),
        csvFiles: calculateChange(csvFilesThisWeek, csvFilesLastWeek),
        contacts: calculateChange(contactsThisWeek, contactsLastWeek),
      },
    };
  }

  async getEmailPerformance(days: number = 7) {
    const now = new Date();
    const startDate = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

    // Get all campaign emails with their timestamps
    const { data: emails } = await this.supabase
      .from('campaign_emails')
      .select('status, sent_at, delivered_at, opened_at, clicked_at, created_at')
      .gte('created_at', startDate.toISOString());

    // Initialize daily stats
    const dailyStats: Record<string, { sent: number; opened: number; clicked: number }> = {};
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    // Initialize all days
    for (let i = days - 1; i >= 0; i--) {
      const date = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
      const dayName = dayNames[date.getDay()];
      const dateKey = date.toISOString().split('T')[0];
      dailyStats[dateKey] = { sent: 0, opened: 0, clicked: 0, name: dayName } as any;
    }

    // Count emails by day
    emails?.forEach((email) => {
      // Count sent emails
      if (email.sent_at) {
        const sentDate = new Date(email.sent_at).toISOString().split('T')[0];
        if (dailyStats[sentDate]) {
          dailyStats[sentDate].sent++;
        }
      }

      // Count opened emails
      if (email.opened_at) {
        const openedDate = new Date(email.opened_at).toISOString().split('T')[0];
        if (dailyStats[openedDate]) {
          dailyStats[openedDate].opened++;
        }
      }

      // Count clicked emails
      if (email.clicked_at) {
        const clickedDate = new Date(email.clicked_at).toISOString().split('T')[0];
        if (dailyStats[clickedDate]) {
          dailyStats[clickedDate].clicked++;
        }
      }
    });

    // Convert to array format for the chart
    const chartData = Object.entries(dailyStats).map(([date, stats]) => {
      const dayName = dayNames[new Date(date).getDay()];
      return {
        name: dayName,
        date,
        sent: stats.sent,
        opened: stats.opened,
        clicked: stats.clicked,
      };
    });

    return chartData;
  }

  async getCampaignReport(campaignId: string) {
    // Get campaign details
    const { data: campaign, error } = await this.supabase
      .from('campaigns')
      .select(
        `
        *,
        template:templates(id, name, subject),
        csv_file:csv_files(id, name, row_count)
      `,
      )
      .eq('id', campaignId)
      .single();

    if (error) throw error;

    // Get email status breakdown
    const { data: emails } = await this.supabase
      .from('campaign_emails')
      .select('status, sent_at, delivered_at, opened_at, clicked_at, bounced_at')
      .eq('campaign_id', campaignId);

    const statusBreakdown = {
      pending: 0,
      queued: 0,
      sending: 0,
      sent: 0,
      delivered: 0,
      opened: 0,
      clicked: 0,
      bounced: 0,
      failed: 0,
      unsubscribed: 0,
    };

    emails?.forEach((email) => {
      statusBreakdown[email.status as keyof typeof statusBreakdown]++;
    });

    // Calculate rates
    const totalEmails = emails?.length || 0;
    const sentEmails = statusBreakdown.sent + statusBreakdown.delivered + statusBreakdown.opened + statusBreakdown.clicked;
    const deliveredEmails = statusBreakdown.delivered + statusBreakdown.opened + statusBreakdown.clicked;
    const openedEmails = statusBreakdown.opened + statusBreakdown.clicked;

    const rates = {
      deliveryRate: sentEmails > 0 ? ((deliveredEmails / sentEmails) * 100).toFixed(2) : '0.00',
      openRate: deliveredEmails > 0 ? ((openedEmails / deliveredEmails) * 100).toFixed(2) : '0.00',
      clickRate: openedEmails > 0 ? ((statusBreakdown.clicked / openedEmails) * 100).toFixed(2) : '0.00',
      bounceRate: sentEmails > 0 ? ((statusBreakdown.bounced / sentEmails) * 100).toFixed(2) : '0.00',
    };

    // Get timeline data (events per hour)
    const { data: events } = await this.supabase
      .from('email_events')
      .select('event_type, occurred_at')
      .in(
        'campaign_email_id',
        emails?.map((e) => e) || [],
      );

    return {
      campaign,
      stats: {
        total: totalEmails,
        ...statusBreakdown,
      },
      rates,
      timeline: this.groupEventsByTime(events || []),
    };
  }

  private groupEventsByTime(events: { event_type: string; occurred_at: string }[]) {
    const timeline: Record<string, Record<string, number>> = {};

    events.forEach((event) => {
      const hour = new Date(event.occurred_at).toISOString().slice(0, 13) + ':00:00Z';
      if (!timeline[hour]) {
        timeline[hour] = {};
      }
      timeline[hour][event.event_type] = (timeline[hour][event.event_type] || 0) + 1;
    });

    return Object.entries(timeline)
      .map(([time, counts]) => ({ time, ...counts }))
      .sort((a, b) => a.time.localeCompare(b.time));
  }

  async getRecentActivity(limit = 20) {
    // Get recent email events
    const { data: events } = await this.supabase
      .from('email_events')
      .select(
        `
        *,
        campaign_email:campaign_emails(
          email_address,
          campaign:campaigns(id, name)
        )
      `,
      )
      .order('occurred_at', { ascending: false })
      .limit(limit);

    return events;
  }

  async getEmailDetails(campaignEmailId: string) {
    // Get email details
    const { data: email, error } = await this.supabase
      .from('campaign_emails')
      .select(
        `
        *,
        csv_contact:csv_contacts(*),
        campaign:campaigns(id, name, from_name, from_email)
      `,
      )
      .eq('id', campaignEmailId)
      .single();

    if (error) throw error;

    // Get all events for this email
    const { data: events } = await this.supabase
      .from('email_events')
      .select('*')
      .eq('campaign_email_id', campaignEmailId)
      .order('occurred_at', { ascending: true });

    return {
      email,
      events,
    };
  }

  async getCampaignComparison(campaignIds: string[]) {
    const reports = await Promise.all(
      campaignIds.map((id) => this.getCampaignReport(id)),
    );

    return reports.map((report) => ({
      id: report.campaign.id,
      name: report.campaign.name,
      status: report.campaign.status,
      stats: report.stats,
      rates: report.rates,
      startedAt: report.campaign.started_at,
      completedAt: report.campaign.completed_at,
    }));
  }

  async exportCampaignReport(campaignId: string) {
    const report = await this.getCampaignReport(campaignId);

    // Get all emails with contact details
    const { data: emails } = await this.supabase
      .from('campaign_emails')
      .select(
        `
        email_address,
        recipient_name,
        status,
        sent_at,
        delivered_at,
        opened_at,
        clicked_at,
        bounced_at,
        error_message
      `,
      )
      .eq('campaign_id', campaignId);

    return {
      summary: {
        campaignName: report.campaign.name,
        status: report.campaign.status,
        totalEmails: report.stats.total,
        sentEmails: report.stats.sent,
        deliveryRate: report.rates.deliveryRate,
        openRate: report.rates.openRate,
        clickRate: report.rates.clickRate,
        bounceRate: report.rates.bounceRate,
      },
      emails,
    };
  }
}

