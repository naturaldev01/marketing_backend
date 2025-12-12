import { IsString, IsOptional, IsBoolean, IsArray } from 'class-validator';
import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';

export class CreateTemplateDto {
  @ApiProperty({ example: 'Welcome Email' })
  @IsString()
  name: string;

  @ApiProperty({ example: 'Welcome to {{companyName}}!' })
  @IsString()
  subject: string;

  @ApiPropertyOptional({ example: '<h1>Hello {{firstName}}!</h1><p>Welcome to our platform.</p>' })
  @IsString()
  @IsOptional()
  bodyHtml?: string;

  @ApiPropertyOptional({ example: 'Hello {{firstName}}! Welcome to our platform.' })
  @IsString()
  @IsOptional()
  bodyText?: string;

  @ApiPropertyOptional({ example: ['firstName', 'companyName'] })
  @IsArray()
  @IsOptional()
  variables?: string[];

  @ApiPropertyOptional({ example: true })
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}

export class UpdateTemplateDto extends PartialType(CreateTemplateDto) {}

