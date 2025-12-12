import { Injectable, NotFoundException, BadRequestException, Inject, forwardRef } from '@nestjs/common';
import { getSupabaseAdminClient } from '../../config/supabase.config';
import { CreateCampaignDto, UpdateCampaignDto } from './dto/campaign.dto';
import { TemplatesService } from '../templates/templates.service';
import { CsvFilesService } from '../csv-files/csv-files.service';
import { CampaignSchedulerService } from './campaign-scheduler.service';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class CampaignsService {
  private supabase = getSupabaseAdminClient();

  constructor(
    private templatesService: TemplatesService,
    private csvFilesService: CsvFilesService,
    @Inject(forwardRef(() => CampaignSchedulerService))
    private schedulerService: CampaignSchedulerService,
  ) {}

  async create(dto: CreateCampaignDto, userId: string) {
    // Validate template exists if provided
    if (dto.templateId) {
      await this.templatesService.findOne(dto.templateId);
    }

    // Validate CSV file exists if provided
    if (dto.csvFileId) {
      const csvFile = await this.csvFilesService.findOne(dto.csvFileId);
      if (csvFile.status !== 'ready') {
        throw new BadRequestException('CSV file is not ready yet');
      }
    }

    const { data, error } = await this.supabase
      .from('campaigns')
      .insert({
        name: dto.name,
        description: dto.description,
        template_id: dto.templateId,
        csv_file_id: dto.csvFileId,
        from_name: dto.fromName,
        from_email: dto.fromEmail,
        reply_to: dto.replyTo,
        subject_override: dto.subjectOverride,
        status: 'draft',
        send_options: dto.sendOptions || {},
        created_by: userId,
      })
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  async findAll(options?: { status?: string; search?: string }) {
    let query = this.supabase
      .from('campaigns')
      .select(
        `
        *,
        template:templates(id, name, subject),
        csv_file:csv_files(id, name, row_count)
      `,
      )
      .order('created_at', { ascending: false });

    if (options?.status) {
      query = query.eq('status', options.status);
    }

    if (options?.search) {
      query = query.or(`name.ilike.%${options.search}%,description.ilike.%${options.search}%`);
    }

    const { data, error } = await query;
    if (error) throw error;
    return data;
  }

  async findOne(id: string) {
    const { data, error } = await this.supabase
      .from('campaigns')
      .select(
        `
        *,
        template:templates(*),
        csv_file:csv_files(*)
      `,
      )
      .eq('id', id)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        throw new NotFoundException(`Campaign with ID ${id} not found`);
      }
      throw error;
    }
    return data;
  }

  async update(id: string, dto: UpdateCampaignDto) {
    // Check campaign exists and is in draft status
    const campaign = await this.findOne(id);
    if (campaign.status !== 'draft' && campaign.status !== 'paused') {
      throw new BadRequestException('Can only update campaigns in draft or paused status');
    }

    const updateData: Record<string, unknown> = {};
    if (dto.name !== undefined) updateData.name = dto.name;
    if (dto.description !== undefined) updateData.description = dto.description;
    if (dto.templateId !== undefined) updateData.template_id = dto.templateId;
    if (dto.csvFileId !== undefined) updateData.csv_file_id = dto.csvFileId;
    if (dto.fromName !== undefined) updateData.from_name = dto.fromName;
    if (dto.fromEmail !== undefined) updateData.from_email = dto.fromEmail;
    if (dto.replyTo !== undefined) updateData.reply_to = dto.replyTo;
    if (dto.subjectOverride !== undefined) updateData.subject_override = dto.subjectOverride;
    if (dto.sendOptions !== undefined) updateData.send_options = dto.sendOptions;

    const { data, error } = await this.supabase
      .from('campaigns')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  async remove(id: string) {
    const campaign = await this.findOne(id);
    if (campaign.status === 'sending') {
      throw new BadRequestException('Cannot delete a campaign that is currently sending');
    }

    // Delete campaign emails first
    await this.supabase.from('campaign_emails').delete().eq('campaign_id', id);

    const { error } = await this.supabase.from('campaigns').delete().eq('id', id);
    if (error) throw error;

    return { message: 'Campaign deleted successfully' };
  }

  async schedule(id: string, scheduledAt: Date, timezone?: string) {
    const campaign = await this.findOne(id);

    if (campaign.status !== 'draft') {
      throw new BadRequestException('Can only schedule campaigns in draft status');
    }

    if (!campaign.template_id || !campaign.csv_file_id) {
      throw new BadRequestException('Campaign must have a template and CSV file to be scheduled');
    }

    // Prepare campaign emails
    await this.prepareCampaignEmails(id);

    // Update send_options with timezone if provided
    const updatedSendOptions = {
      ...(campaign.send_options || {}),
      timezone: timezone || campaign.send_options?.timezone || 'Europe/Istanbul',
      scheduledTimezone: timezone || 'Europe/Istanbul',
    };

    const { data, error } = await this.supabase
      .from('campaigns')
      .update({
        status: 'scheduled',
        scheduled_at: scheduledAt.toISOString(),
        send_options: updatedSendOptions,
      })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  async start(id: string) {
    const campaign = await this.findOne(id);

    if (campaign.status !== 'draft' && campaign.status !== 'scheduled') {
      throw new BadRequestException('Can only start campaigns in draft or scheduled status');
    }

    if (!campaign.template_id || !campaign.csv_file_id) {
      throw new BadRequestException('Campaign must have a template and CSV file to start');
    }

    // Prepare campaign emails if not already done
    const { count } = await this.supabase
      .from('campaign_emails')
      .select('*', { count: 'exact', head: true })
      .eq('campaign_id', id);

    if (!count || count === 0) {
      await this.prepareCampaignEmails(id);
    }

    const { data, error } = await this.supabase
      .from('campaigns')
      .update({
        status: 'sending',
        started_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    // Start the email sending process
    this.schedulerService.scheduleNow(id).catch(console.error);

    return data;
  }

  async pause(id: string) {
    const campaign = await this.findOne(id);

    if (campaign.status !== 'sending') {
      throw new BadRequestException('Can only pause campaigns that are currently sending');
    }

    // Stop the email sender
    await this.schedulerService.stopCampaign(id);

    const { data, error } = await this.supabase
      .from('campaigns')
      .update({ status: 'paused' })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  async cancel(id: string) {
    const campaign = await this.findOne(id);

    if (campaign.status === 'sent' || campaign.status === 'cancelled') {
      throw new BadRequestException('Campaign is already completed or cancelled');
    }

    const { data, error } = await this.supabase
      .from('campaigns')
      .update({ status: 'cancelled' })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  private async prepareCampaignEmails(campaignId: string) {
    const campaign = await this.findOne(campaignId);

    // Get all valid contacts from the CSV file
    const { data: contacts, error } = await this.supabase
      .from('csv_contacts')
      .select('*')
      .eq('csv_file_id', campaign.csv_file_id)
      .eq('is_valid', true);

    if (error) throw error;

    if (!contacts || contacts.length === 0) {
      throw new BadRequestException('No valid contacts found in the CSV file');
    }

    // Create campaign emails
    const campaignEmails = contacts.map((contact) => ({
      id: uuidv4(),
      campaign_id: campaignId,
      csv_contact_id: contact.id,
      email_address: contact.email,
      recipient_name: [contact.first_name, contact.last_name].filter(Boolean).join(' ') || null,
      status: 'pending',
    }));

    // Insert in batches
    const batchSize = 500;
    for (let i = 0; i < campaignEmails.length; i += batchSize) {
      const batch = campaignEmails.slice(i, i + batchSize);
      const { error: insertError } = await this.supabase.from('campaign_emails').insert(batch);
      if (insertError) throw insertError;
    }

    // Update campaign stats
    await this.supabase
      .from('campaigns')
      .update({
        stats: {
          total: contacts.length,
          sent: 0,
          delivered: 0,
          opened: 0,
          clicked: 0,
          bounced: 0,
          failed: 0,
        },
      })
      .eq('id', campaignId);
  }

  async getCampaignEmails(campaignId: string, options?: { status?: string; page?: number; limit?: number }) {
    const page = options?.page || 1;
    const limit = options?.limit || 50;
    const offset = (page - 1) * limit;

    let query = this.supabase
      .from('campaign_emails')
      .select('*, csv_contact:csv_contacts(*)', { count: 'exact' })
      .eq('campaign_id', campaignId)
      .range(offset, offset + limit - 1);

    if (options?.status) {
      query = query.eq('status', options.status);
    }

    const { data, error, count } = await query;
    if (error) throw error;

    return {
      data,
      pagination: {
        page,
        limit,
        total: count,
        totalPages: Math.ceil((count || 0) / limit),
      },
    };
  }

  async duplicate(id: string, userId: string) {
    const original = await this.findOne(id);

    const { data, error } = await this.supabase
      .from('campaigns')
      .insert({
        name: `${original.name} (Copy)`,
        description: original.description,
        template_id: original.template_id,
        csv_file_id: original.csv_file_id,
        from_name: original.from_name,
        from_email: original.from_email,
        reply_to: original.reply_to,
        subject_override: original.subject_override,
        status: 'draft',
        send_options: original.send_options,
        created_by: userId,
      })
      .select()
      .single();

    if (error) throw error;
    return data;
  }
}

