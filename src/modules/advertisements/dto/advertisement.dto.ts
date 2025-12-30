import { IsString, IsUrl, IsOptional, IsBoolean } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateAdvertisementDto {
  @ApiProperty({ description: 'Name of the advertisement' })
  @IsString()
  name: string;

  @ApiProperty({ required: false, description: 'Description of the advertisement' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ description: 'Destination URL where users will be redirected' })
  @IsUrl()
  destination_url: string;

  @ApiProperty({ required: false, description: 'Platform (e.g., Google Ads, Facebook, Instagram)' })
  @IsOptional()
  @IsString()
  platform?: string;

  @ApiProperty({ required: false, description: 'UTM Source parameter' })
  @IsOptional()
  @IsString()
  utm_source?: string;

  @ApiProperty({ required: false, description: 'UTM Medium parameter' })
  @IsOptional()
  @IsString()
  utm_medium?: string;

  @ApiProperty({ required: false, description: 'UTM Campaign parameter' })
  @IsOptional()
  @IsString()
  utm_campaign?: string;
}

export class UpdateAdvertisementDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsUrl()
  destination_url?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  platform?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  utm_source?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  utm_medium?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  utm_campaign?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}

