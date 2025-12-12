import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Delete,
  UseGuards,
  Req,
  Query,
  UseInterceptors,
  UploadedFile,
  ParseFilePipe,
  MaxFileSizeValidator,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiConsumes,
  ApiBody,
  ApiQuery,
} from '@nestjs/swagger';
import { CsvFilesService } from './csv-files.service';
import { FilterCsvDto } from './dto/csv-file.dto';
import { SupabaseGuard } from '../auth/guards/supabase.guard';

@ApiTags('CSV Files')
@Controller('api/csv-files')
@UseGuards(SupabaseGuard)
@ApiBearerAuth()
export class CsvFilesController {
  constructor(private readonly csvFilesService: CsvFilesService) {}

  @Post('upload')
  @ApiOperation({ summary: 'Upload a CSV file' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
        name: { type: 'string' },
      },
    },
  })
  @UseInterceptors(FileInterceptor('file'))
  uploadFile(
    @UploadedFile(
      new ParseFilePipe({
        validators: [
          new MaxFileSizeValidator({ maxSize: 50 * 1024 * 1024 }), // 50MB
        ],
        fileIsRequired: true,
      }),
    )
    file: Express.Multer.File,
    @Body('name') name: string,
    @Req() req: any,
  ) {
    // Validate file extension manually (MIME types can be unreliable for CSV)
    const originalName = file.originalname.toLowerCase();
    if (!originalName.endsWith('.csv')) {
      throw new BadRequestException('Sadece CSV dosyaları yüklenebilir');
    }
    return this.csvFilesService.uploadFile(file, name || file.originalname, req.user.id);
  }

  @Get()
  @ApiOperation({ summary: 'Get all CSV files' })
  @ApiQuery({ name: 'isFiltered', required: false, type: Boolean })
  @ApiQuery({ name: 'status', required: false, enum: ['processing', 'ready', 'error'] })
  findAll(
    @Query('isFiltered') isFiltered?: string,
    @Query('status') status?: string,
  ) {
    return this.csvFilesService.findAll({
      isFiltered: isFiltered ? isFiltered === 'true' : undefined,
      status,
    });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a CSV file by ID' })
  findOne(@Param('id') id: string) {
    return this.csvFilesService.findOne(id);
  }

  @Get(':id/contacts')
  @ApiOperation({ summary: 'Get contacts from a CSV file' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'isValid', required: false, type: Boolean })
  getContacts(
    @Param('id') id: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('isValid') isValid?: string,
  ) {
    return this.csvFilesService.getContacts(id, {
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
      isValid: isValid ? isValid === 'true' : undefined,
    });
  }

  @Get(':id/filter-options')
  @ApiOperation({ summary: 'Get available filter options for a CSV file' })
  getFilterOptions(@Param('id') id: string) {
    return this.csvFilesService.getFilterOptions(id);
  }

  @Post(':id/filter')
  @ApiOperation({ summary: 'Filter contacts and create a new CSV file' })
  filterContacts(
    @Param('id') id: string,
    @Body() filterDto: FilterCsvDto,
    @Req() req: any,
  ) {
    return this.csvFilesService.filterContacts(id, filterDto, req.user.id);
  }

  @Get(':id/stats')
  @ApiOperation({ summary: 'Get statistics for a CSV file' })
  getStats(@Param('id') id: string) {
    return this.csvFilesService.getStats(id);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a CSV file' })
  remove(@Param('id') id: string) {
    return this.csvFilesService.remove(id);
  }
}

