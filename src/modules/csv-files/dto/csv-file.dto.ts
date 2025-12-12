import { IsString, IsOptional, IsArray } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class FilterCsvDto {
  @ApiPropertyOptional({ example: 'Filtered List - Turkey' })
  @IsString()
  @IsOptional()
  name?: string;

  @ApiPropertyOptional({ example: ['Turkey', 'Germany', 'USA'] })
  @IsArray()
  @IsOptional()
  countries?: string[];

  @ApiPropertyOptional({ example: ['Europe/Istanbul', 'America/New_York'] })
  @IsArray()
  @IsOptional()
  timezones?: string[];

  @ApiPropertyOptional({ example: ['gmail.com', 'yahoo.com'] })
  @IsArray()
  @IsOptional()
  emailDomains?: string[];
}

