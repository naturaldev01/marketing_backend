import { Injectable, NotFoundException } from '@nestjs/common';
import { getSupabaseAdminClient } from '../../config/supabase.config';
import { CreateTemplateDto, UpdateTemplateDto } from './dto/template.dto';

@Injectable()
export class TemplatesService {
  private supabase = getSupabaseAdminClient();

  async create(dto: CreateTemplateDto, userId: string) {
    const { data, error } = await this.supabase
      .from('templates')
      .insert({
        name: dto.name,
        subject: dto.subject,
        body_html: dto.bodyHtml,
        body_text: dto.bodyText,
        variables: dto.variables || [],
        is_active: dto.isActive ?? true,
        created_by: userId,
      })
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  async findAll(options?: { isActive?: boolean; search?: string }) {
    let query = this.supabase.from('templates').select('*').order('created_at', { ascending: false });

    if (options?.isActive !== undefined) {
      query = query.eq('is_active', options.isActive);
    }

    if (options?.search) {
      query = query.or(`name.ilike.%${options.search}%,subject.ilike.%${options.search}%`);
    }

    const { data, error } = await query;

    if (error) throw error;
    return data;
  }

  async findOne(id: string) {
    const { data, error } = await this.supabase
      .from('templates')
      .select('*')
      .eq('id', id)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        throw new NotFoundException(`Template with ID ${id} not found`);
      }
      throw error;
    }
    return data;
  }

  async update(id: string, dto: UpdateTemplateDto) {
    const updateData: Record<string, unknown> = {};
    if (dto.name !== undefined) updateData.name = dto.name;
    if (dto.subject !== undefined) updateData.subject = dto.subject;
    if (dto.bodyHtml !== undefined) updateData.body_html = dto.bodyHtml;
    if (dto.bodyText !== undefined) updateData.body_text = dto.bodyText;
    if (dto.variables !== undefined) updateData.variables = dto.variables;
    if (dto.isActive !== undefined) updateData.is_active = dto.isActive;

    const { data, error } = await this.supabase
      .from('templates')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        throw new NotFoundException(`Template with ID ${id} not found`);
      }
      throw error;
    }
    return data;
  }

  async remove(id: string) {
    const { error } = await this.supabase.from('templates').delete().eq('id', id);

    if (error) throw error;
    return { message: 'Template deleted successfully' };
  }

  async duplicate(id: string, userId: string) {
    const original = await this.findOne(id);

    const { data, error } = await this.supabase
      .from('templates')
      .insert({
        name: `${original.name} (Copy)`,
        subject: original.subject,
        body_html: original.body_html,
        body_text: original.body_text,
        variables: original.variables,
        is_active: false,
        created_by: userId,
      })
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  // Extract variables from template content (e.g., {{firstName}}, {{email}})
  extractVariables(content: string): string[] {
    const regex = /\{\{(\w+)\}\}/g;
    const matches = content.matchAll(regex);
    const variables = new Set<string>();
    for (const match of matches) {
      variables.add(match[1]);
    }
    return Array.from(variables);
  }
}

