import {
  Controller,
  Post,
  Get,
  Delete,
  Param,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
  Query,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiConsumes, ApiBody } from '@nestjs/swagger';
import { SupabaseGuard } from '../auth/guards/supabase.guard';
import { getSupabaseAdminClient } from '../../config/supabase.config';
import { v4 as uuidv4 } from 'uuid';

interface MulterFile {
  fieldname: string;
  originalname: string;
  encoding: string;
  mimetype: string;
  buffer: Buffer;
  size: number;
}

@ApiTags('Images')
@Controller('api/images')
@UseGuards(SupabaseGuard)
@ApiBearerAuth()
export class ImagesController {
  private supabase = getSupabaseAdminClient();
  private readonly bucketName = 'images';

  @Post('upload')
  @ApiOperation({ summary: 'Upload an image for email templates' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
        },
      },
    },
  })
  @UseInterceptors(FileInterceptor('file'))
  async uploadImage(@UploadedFile() file: MulterFile) {
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }

    // Validate file type
    const allowedMimeTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml'];
    if (!allowedMimeTypes.includes(file.mimetype)) {
      throw new BadRequestException(
        'Invalid file type. Allowed types: JPEG, PNG, GIF, WebP, SVG',
      );
    }

    // Validate file size (5MB max)
    const maxSize = 5 * 1024 * 1024;
    if (file.size > maxSize) {
      throw new BadRequestException('File too large. Maximum size is 5MB');
    }

    // Generate unique filename
    const ext = file.originalname.split('.').pop() || 'jpg';
    const filename = `${uuidv4()}.${ext}`;
    const filePath = `email-assets/${filename}`;

    // Upload to Supabase Storage
    const { data, error } = await this.supabase.storage
      .from(this.bucketName)
      .upload(filePath, file.buffer, {
        contentType: file.mimetype,
        upsert: false,
      });

    if (error) {
      throw new BadRequestException(`Failed to upload image: ${error.message}`);
    }

    // Get public URL
    const { data: urlData } = this.supabase.storage
      .from(this.bucketName)
      .getPublicUrl(filePath);

    return {
      success: true,
      filename: file.originalname,
      path: data.path,
      url: urlData.publicUrl,
      size: file.size,
      mimeType: file.mimetype,
    };
  }

  @Get()
  @ApiOperation({ summary: 'List all uploaded images' })
  async listImages(@Query('folder') folder?: string) {
    const path = folder || 'email-assets';
    
    const { data, error } = await this.supabase.storage
      .from(this.bucketName)
      .list(path, {
        limit: 100,
        sortBy: { column: 'created_at', order: 'desc' },
      });

    if (error) {
      throw new BadRequestException(`Failed to list images: ${error.message}`);
    }

    // Add public URLs to each file
    const filesWithUrls = (data || [])
      .filter(file => file.name && !file.name.startsWith('.'))
      .map(file => {
        const filePath = `${path}/${file.name}`;
        const { data: urlData } = this.supabase.storage
          .from(this.bucketName)
          .getPublicUrl(filePath);

        return {
          id: file.id,
          name: file.name,
          path: filePath,
          url: urlData.publicUrl,
          size: file.metadata?.size,
          mimeType: file.metadata?.mimetype,
          createdAt: file.created_at,
        };
      });

    return filesWithUrls;
  }

  @Delete(':filename')
  @ApiOperation({ summary: 'Delete an image' })
  async deleteImage(@Param('filename') filename: string) {
    const filePath = `email-assets/${filename}`;

    const { error } = await this.supabase.storage
      .from(this.bucketName)
      .remove([filePath]);

    if (error) {
      throw new BadRequestException(`Failed to delete image: ${error.message}`);
    }

    return { success: true, message: 'Image deleted successfully' };
  }
}

