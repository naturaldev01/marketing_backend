import { IsEmail, IsString, MinLength, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SignUpDto {
  @ApiProperty({ example: 'user@example.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'password123', minLength: 6 })
  @IsString()
  @MinLength(6)
  password: string;

  @ApiPropertyOptional({ example: 'John Doe' })
  @IsString()
  @IsOptional()
  fullName?: string;
}

export class SignInDto {
  @ApiProperty({ example: 'user@example.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'password123' })
  @IsString()
  password: string;
}

export class RefreshTokenDto {
  @ApiProperty({ description: 'Refresh token from previous login' })
  @IsString()
  refreshToken: string;
}

export class UpdateProfileDto {
  @ApiPropertyOptional({ example: 'John Doe' })
  @IsString()
  @IsOptional()
  full_name?: string;

  @ApiPropertyOptional({ example: 'manager', enum: ['admin', 'manager', 'member'] })
  @IsString()
  @IsOptional()
  role?: string;
}

