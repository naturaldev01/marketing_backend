import {
  Controller,
  Post,
  Body,
  Get,
  UseGuards,
  Req,
  Put,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { SupabaseGuard } from './guards/supabase.guard';
import { SignUpDto, SignInDto, RefreshTokenDto, UpdateProfileDto } from './dto/auth.dto';

@ApiTags('Auth')
@Controller('api/auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('signup')
  @ApiOperation({ summary: 'Register a new user' })
  async signUp(@Body() dto: SignUpDto) {
    return this.authService.signUp(dto.email, dto.password, dto.fullName);
  }

  @Post('signin')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Sign in user' })
  async signIn(@Body() dto: SignInDto) {
    return this.authService.signIn(dto.email, dto.password);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Refresh access token' })
  async refreshToken(@Body() dto: RefreshTokenDto) {
    return this.authService.refreshToken(dto.refreshToken);
  }

  @Post('signout')
  @UseGuards(SupabaseGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Sign out user' })
  async signOut(@Req() req: any) {
    const token = req.headers.authorization?.replace('Bearer ', '');
    return this.authService.signOut(token);
  }

  @Get('me')
  @UseGuards(SupabaseGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get current user' })
  async getMe(@Req() req: any) {
    return req.user;
  }

  @Get('profile')
  @UseGuards(SupabaseGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get user profile' })
  async getProfile(@Req() req: any) {
    return this.authService.getProfile(req.user.id);
  }

  @Put('profile')
  @UseGuards(SupabaseGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update user profile' })
  async updateProfile(@Req() req: any, @Body() dto: UpdateProfileDto) {
    return this.authService.updateProfile(req.user.id, dto);
  }
}

