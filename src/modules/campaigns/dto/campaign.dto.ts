import { IsString, IsOptional, IsUUID, IsEmail, IsObject, IsDateString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';

export class CreateCampaignDto {
  @ApiProperty({ example: 'Summer Sale Campaign' })
  @IsString()
  name: string;

  @ApiPropertyOptional({ example: 'Promote our summer collection' })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({ example: 'uuid-of-template' })
  @IsUUID()
  @IsOptional()
  templateId?: string;

  @ApiPropertyOptional({ example: 'uuid-of-csv-file' })
  @IsUUID()
  @IsOptional()
  csvFileId?: string;

  @ApiProperty({ example: 'Natural Clinic' })
  @IsString()
  fromName: string;

  @ApiProperty({ example: 'marketing@naturalclinic.com' })
  @IsEmail()
  fromEmail: string;

  @ApiPropertyOptional({ example: 'support@naturalclinic.com' })
  @IsEmail()
  @IsOptional()
  replyTo?: string;

  @ApiPropertyOptional({ example: 'Custom Subject Line' })
  @IsString()
  @IsOptional()
  subjectOverride?: string;

  @ApiPropertyOptional({ example: { trackOpens: true, trackClicks: true } })
  @IsObject()
  @IsOptional()
  sendOptions?: Record<string, unknown>;
}

export class UpdateCampaignDto extends PartialType(CreateCampaignDto) {}

export class ScheduleCampaignDto {
  @ApiProperty({ example: '2024-12-25T10:00:00Z' })
  @IsDateString()
  scheduledAt: string;

  @ApiPropertyOptional({ example: 'Europe/Istanbul', description: 'Timezone for scheduled send' })
  @IsString()
  @IsOptional()
  timezone?: string;
}

