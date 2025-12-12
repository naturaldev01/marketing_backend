import { Injectable, NotFoundException, BadRequestException, InternalServerErrorException, ForbiddenException } from '@nestjs/common';
import { getSupabaseAdminClient } from '../../config/supabase.config';
import { parse } from 'csv-parse/sync';
import { v4 as uuidv4 } from 'uuid';
import { FilterCsvDto } from './dto/csv-file.dto';

// Helper to handle Supabase errors properly
function handleSupabaseError(error: unknown): never {
  if (error && typeof error === 'object') {
    const err = error as { message?: string; statusCode?: string | number; status?: string | number };
    const statusCode = parseInt(String(err.statusCode || err.status || 500), 10);
    const message = err.message || 'An error occurred';
    
    if (statusCode === 403) {
      throw new ForbiddenException(message);
    } else if (statusCode === 404) {
      throw new NotFoundException(message);
    } else if (statusCode === 400) {
      throw new BadRequestException(message);
    }
    throw new InternalServerErrorException(message);
  }
  throw new InternalServerErrorException('An unexpected error occurred');
}

interface CsvContact {
  email: string;
  first_name?: string;
  last_name?: string;
  country?: string;
  timezone?: string;
  phone?: string;
  company?: string;
  custom_fields?: Record<string, unknown>;
}

@Injectable()
export class CsvFilesService {
  private supabase = getSupabaseAdminClient();

  async uploadFile(file: Express.Multer.File, name: string, userId: string) {
    const fileId = uuidv4();
    const storagePath = `csv/${userId}/${fileId}/${file.originalname}`;

    // Upload file to storage
    const { error: uploadError } = await this.supabase.storage
      .from('uploads')
      .upload(storagePath, file.buffer, {
        contentType: file.mimetype,
      });

    if (uploadError) {
      console.error('Storage upload error:', uploadError);
      handleSupabaseError(uploadError);
    }

    // Create CSV file record
    const { data: csvFile, error: insertError } = await this.supabase
      .from('csv_files')
      .insert({
        id: fileId,
        name,
        original_filename: file.originalname,
        storage_path: storagePath,
        status: 'processing',
        created_by: userId,
      })
      .select()
      .single();

    if (insertError) {
      console.error('Database insert error:', insertError);
      handleSupabaseError(insertError);
    }

    // Process CSV in background
    this.processCSV(fileId, file.buffer).catch(console.error);

    return csvFile;
  }

  private async processCSV(fileId: string, buffer: Buffer) {
    try {
      const content = buffer.toString('utf-8');
      const records = parse(content, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
      });

      if (records.length === 0) {
        await this.updateFileStatus(fileId, 'error', 'CSV file is empty');
        return;
      }

      // Detect column mapping
      const firstRow = records[0] as Record<string, string>;
      const columnMapping = this.detectColumnMapping(Object.keys(firstRow));

      // Insert contacts
      const contacts: CsvContact[] = records.map((row: Record<string, string>) => {
        const contact: CsvContact = {
          email: this.getValueByMapping(row, columnMapping, 'email') || '',
          first_name: this.getValueByMapping(row, columnMapping, 'first_name'),
          last_name: this.getValueByMapping(row, columnMapping, 'last_name'),
          country: this.getValueByMapping(row, columnMapping, 'country'),
          timezone: this.getValueByMapping(row, columnMapping, 'timezone'),
          phone: this.getValueByMapping(row, columnMapping, 'phone'),
          company: this.getValueByMapping(row, columnMapping, 'company'),
        };

        // Store unmapped fields as custom_fields
        const mappedColumns = Object.values(columnMapping);
        const customFields: Record<string, string> = {};
        for (const [key, value] of Object.entries(row)) {
          if (!mappedColumns.includes(key)) {
            customFields[key] = value;
          }
        }
        if (Object.keys(customFields).length > 0) {
          contact.custom_fields = customFields;
        }

        return contact;
      });

      // Validate emails and insert contacts in batches
      const batchSize = 500;
      let validCount = 0;

      for (let i = 0; i < contacts.length; i += batchSize) {
        const batch = contacts.slice(i, i + batchSize).map((contact) => ({
          csv_file_id: fileId,
          ...contact,
          is_valid: this.isValidEmail(contact.email),
          validation_error: this.isValidEmail(contact.email) ? null : 'Invalid email format',
        }));

        const { error } = await this.supabase.from('csv_contacts').insert(batch);
        if (error) throw error;

        validCount += batch.filter((c) => c.is_valid).length;
      }

      // Update file status
      await this.supabase
        .from('csv_files')
        .update({
          status: 'ready',
          row_count: contacts.length,
          column_mapping: columnMapping,
        })
        .eq('id', fileId);
    } catch (error) {
      console.error('CSV processing error:', error);
      await this.updateFileStatus(fileId, 'error', (error as Error).message);
    }
  }

  private detectColumnMapping(columns: string[]): Record<string, string> {
    const mapping: Record<string, string> = {};
    const patterns = {
      email: ['email', 'e-mail', 'mail', 'email_address'],
      first_name: ['first_name', 'firstname', 'first', 'name', 'given_name'],
      last_name: ['last_name', 'lastname', 'last', 'surname', 'family_name'],
      country: ['country', 'nation', 'country_code'],
      timezone: ['timezone', 'time_zone', 'tz'],
      phone: ['phone', 'telephone', 'mobile', 'phone_number'],
      company: ['company', 'organization', 'org', 'company_name'],
    };

    for (const [field, aliases] of Object.entries(patterns)) {
      for (const col of columns) {
        if (aliases.includes(col.toLowerCase())) {
          mapping[field] = col;
          break;
        }
      }
    }

    return mapping;
  }

  private getValueByMapping(
    row: Record<string, string>,
    mapping: Record<string, string>,
    field: string,
  ): string | undefined {
    const column = mapping[field];
    return column ? row[column] : undefined;
  }

  private isValidEmail(email: string): boolean {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }

  private async updateFileStatus(fileId: string, status: string, errorMessage?: string) {
    await this.supabase
      .from('csv_files')
      .update({ status, error_message: errorMessage })
      .eq('id', fileId);
  }

  async findAll(options?: { isFiltered?: boolean; status?: string }) {
    let query = this.supabase
      .from('csv_files')
      .select('*')
      .order('created_at', { ascending: false });

    if (options?.isFiltered !== undefined) {
      query = query.eq('is_filtered', options.isFiltered);
    }

    if (options?.status) {
      query = query.eq('status', options.status);
    }

    const { data, error } = await query;
    if (error) throw error;
    return data;
  }

  async findOne(id: string) {
    const { data, error } = await this.supabase
      .from('csv_files')
      .select('*')
      .eq('id', id)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        throw new NotFoundException(`CSV file with ID ${id} not found`);
      }
      throw error;
    }
    return data;
  }

  async getContacts(fileId: string, options?: { page?: number; limit?: number; isValid?: boolean }) {
    const page = options?.page || 1;
    const limit = options?.limit || 50;
    const offset = (page - 1) * limit;

    let query = this.supabase
      .from('csv_contacts')
      .select('*', { count: 'exact' })
      .eq('csv_file_id', fileId)
      .range(offset, offset + limit - 1);

    if (options?.isValid !== undefined) {
      query = query.eq('is_valid', options.isValid);
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

  async filterContacts(fileId: string, dto: FilterCsvDto, userId: string) {
    // Get original file
    const originalFile = await this.findOne(fileId);

    // Build filter query
    let query = this.supabase
      .from('csv_contacts')
      .select('*')
      .eq('csv_file_id', fileId)
      .eq('is_valid', true);

    if (dto.countries && dto.countries.length > 0) {
      query = query.in('country', dto.countries);
    }

    if (dto.timezones && dto.timezones.length > 0) {
      query = query.in('timezone', dto.timezones);
    }

    if (dto.emailDomains && dto.emailDomains.length > 0) {
      const domainFilters = dto.emailDomains.map((d) => `email.ilike.%@${d}`).join(',');
      query = query.or(domainFilters);
    }

    const { data: filteredContacts, error: filterError } = await query;
    if (filterError) throw filterError;

    if (!filteredContacts || filteredContacts.length === 0) {
      throw new BadRequestException('No contacts match the filter criteria');
    }

    // Create new filtered CSV file
    const newFileId = uuidv4();
    const { data: newFile, error: createError } = await this.supabase
      .from('csv_files')
      .insert({
        id: newFileId,
        name: dto.name || `${originalFile.name} (Filtered)`,
        original_filename: originalFile.original_filename,
        storage_path: originalFile.storage_path,
        row_count: filteredContacts.length,
        column_mapping: originalFile.column_mapping,
        is_filtered: true,
        parent_file_id: fileId,
        filter_criteria: {
          countries: dto.countries,
          timezones: dto.timezones,
          emailDomains: dto.emailDomains,
        },
        status: 'ready',
        created_by: userId,
      })
      .select()
      .single();

    if (createError) throw createError;

    // Copy filtered contacts to new file
    const newContacts = filteredContacts.map((contact) => ({
      ...contact,
      id: uuidv4(),
      csv_file_id: newFileId,
      created_at: new Date().toISOString(),
    }));

    const batchSize = 500;
    for (let i = 0; i < newContacts.length; i += batchSize) {
      const batch = newContacts.slice(i, i + batchSize);
      const { error } = await this.supabase.from('csv_contacts').insert(batch);
      if (error) throw error;
    }

    return newFile;
  }

  async getFilterOptions(fileId: string) {
    // Get unique countries
    const { data: countries } = await this.supabase
      .from('csv_contacts')
      .select('country')
      .eq('csv_file_id', fileId)
      .eq('is_valid', true)
      .not('country', 'is', null);

    // Get unique timezones
    const { data: timezones } = await this.supabase
      .from('csv_contacts')
      .select('timezone')
      .eq('csv_file_id', fileId)
      .eq('is_valid', true)
      .not('timezone', 'is', null);

    // Extract unique email domains
    const { data: emails } = await this.supabase
      .from('csv_contacts')
      .select('email')
      .eq('csv_file_id', fileId)
      .eq('is_valid', true);

    const uniqueCountries = [...new Set(countries?.map((c) => c.country).filter(Boolean))];
    const uniqueTimezones = [...new Set(timezones?.map((t) => t.timezone).filter(Boolean))];
    const uniqueDomains = [
      ...new Set(emails?.map((e) => e.email.split('@')[1]).filter(Boolean)),
    ];

    return {
      countries: uniqueCountries,
      timezones: uniqueTimezones,
      emailDomains: uniqueDomains,
    };
  }

  async remove(id: string) {
    // Get file info
    const file = await this.findOne(id);

    // Delete from storage if not filtered (filtered files share storage with parent)
    if (!file.is_filtered) {
      await this.supabase.storage.from('uploads').remove([file.storage_path]);
    }

    // Delete contacts first (cascade should handle this, but being explicit)
    await this.supabase.from('csv_contacts').delete().eq('csv_file_id', id);

    // Delete file record
    const { error } = await this.supabase.from('csv_files').delete().eq('id', id);
    if (error) throw error;

    return { message: 'CSV file deleted successfully' };
  }

  async getStats(fileId: string) {
    const { data, error } = await this.supabase
      .from('csv_contacts')
      .select('is_valid, country, timezone')
      .eq('csv_file_id', fileId);

    if (error) throw error;

    const stats = {
      total: data?.length || 0,
      valid: data?.filter((c) => c.is_valid).length || 0,
      invalid: data?.filter((c) => !c.is_valid).length || 0,
      byCountry: {} as Record<string, number>,
      byTimezone: {} as Record<string, number>,
    };

    data?.forEach((contact) => {
      if (contact.country) {
        stats.byCountry[contact.country] = (stats.byCountry[contact.country] || 0) + 1;
      }
      if (contact.timezone) {
        stats.byTimezone[contact.timezone] = (stats.byTimezone[contact.timezone] || 0) + 1;
      }
    });

    return stats;
  }
}

