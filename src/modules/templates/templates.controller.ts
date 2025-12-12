import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  Req,
  Query,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { TemplatesService } from './templates.service';
import { CreateTemplateDto, UpdateTemplateDto } from './dto/template.dto';
import { SupabaseGuard } from '../auth/guards/supabase.guard';

@ApiTags('Templates')
@Controller('api/templates')
@UseGuards(SupabaseGuard)
@ApiBearerAuth()
export class TemplatesController {
  constructor(private readonly templatesService: TemplatesService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new email template' })
  create(@Body() createTemplateDto: CreateTemplateDto, @Req() req: any) {
    return this.templatesService.create(createTemplateDto, req.user.id);
  }

  @Get()
  @ApiOperation({ summary: 'Get all templates' })
  @ApiQuery({ name: 'isActive', required: false, type: Boolean })
  @ApiQuery({ name: 'search', required: false, type: String })
  findAll(
    @Query('isActive') isActive?: string,
    @Query('search') search?: string,
  ) {
    return this.templatesService.findAll({
      isActive: isActive ? isActive === 'true' : undefined,
      search,
    });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a template by ID' })
  findOne(@Param('id') id: string) {
    return this.templatesService.findOne(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a template' })
  update(@Param('id') id: string, @Body() updateTemplateDto: UpdateTemplateDto) {
    return this.templatesService.update(id, updateTemplateDto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a template' })
  remove(@Param('id') id: string) {
    return this.templatesService.remove(id);
  }

  @Post(':id/duplicate')
  @ApiOperation({ summary: 'Duplicate a template' })
  duplicate(@Param('id') id: string, @Req() req: any) {
    return this.templatesService.duplicate(id, req.user.id);
  }

  @Post('extract-variables')
  @ApiOperation({ summary: 'Extract variables from template content' })
  extractVariables(@Body('content') content: string) {
    return { variables: this.templatesService.extractVariables(content) };
  }
}

