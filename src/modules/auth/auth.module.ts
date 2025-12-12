import { Module } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { SupabaseGuard } from './guards/supabase.guard';

@Module({
  controllers: [AuthController],
  providers: [AuthService, SupabaseGuard],
  exports: [AuthService, SupabaseGuard],
})
export class AuthModule {}

