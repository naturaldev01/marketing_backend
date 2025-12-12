import { Injectable, UnauthorizedException } from '@nestjs/common';
import { getSupabaseAdminClient } from '../../config/supabase.config';

@Injectable()
export class AuthService {
  private supabase = getSupabaseAdminClient();

  async signUp(email: string, password: string, fullName?: string) {
    const { data, error } = await this.supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true, // Auto-confirm for dev, change in production
      user_metadata: {
        full_name: fullName,
      },
    });

    if (error) throw error;

    // Generate session for the new user
    const { data: sessionData, error: sessionError } = await this.supabase.auth.admin.generateLink({
      type: 'magiclink',
      email,
    });

    // Sign in the user to get session
    const { data: signInData, error: signInError } = await this.supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (signInError) throw signInError;

    return {
      user: signInData.user,
      session: {
        access_token: signInData.session?.access_token,
        refresh_token: signInData.session?.refresh_token,
        expires_at: signInData.session?.expires_at,
        expires_in: signInData.session?.expires_in,
      },
    };
  }

  async signIn(email: string, password: string) {
    const { data, error } = await this.supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) throw new UnauthorizedException(error.message);

    return {
      user: data.user,
      session: {
        access_token: data.session?.access_token,
        refresh_token: data.session?.refresh_token,
        expires_at: data.session?.expires_at,
        expires_in: data.session?.expires_in,
      },
    };
  }

  async refreshToken(refreshToken: string) {
    const { data, error } = await this.supabase.auth.refreshSession({
      refresh_token: refreshToken,
    });

    if (error) throw new UnauthorizedException('Invalid refresh token');

    return {
      user: data.user,
      session: {
        access_token: data.session?.access_token,
        refresh_token: data.session?.refresh_token,
        expires_at: data.session?.expires_at,
        expires_in: data.session?.expires_in,
      },
    };
  }

  async signOut(accessToken: string) {
    const { error } = await this.supabase.auth.admin.signOut(accessToken);
    if (error) throw error;
    return { message: 'Signed out successfully' };
  }

  async getUser(accessToken: string) {
    const { data, error } = await this.supabase.auth.getUser(accessToken);
    if (error) throw error;
    return data.user;
  }

  async getProfile(userId: string) {
    const { data, error } = await this.supabase
      .from('profiles')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (error && error.code !== 'PGRST116') throw error;
    return data;
  }

  async updateProfile(userId: string, updates: { full_name?: string; role?: string }) {
    const { data, error } = await this.supabase
      .from('profiles')
      .update(updates)
      .eq('user_id', userId)
      .select()
      .single();

    if (error) throw error;
    return data;
  }
}

