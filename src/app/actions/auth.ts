'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { trustedBrowserOrigin } from '@/lib/supabase/auth-origin';
import { isSignupEnabled } from '@/lib/supabase/signup-policy';
import { Buffer } from 'node:buffer';
import { AUTH_PASSWORD_MAX_UTF8_BYTES, AUTH_PASSWORD_MIN_UTF8_BYTES } from '@/lib/supabase/password-policy';

function safeNext(value: FormDataEntryValue | null, fallback = '/today'): string {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return fallback;
  return value;
}

function emailAddress(value: FormDataEntryValue | null): string | null {
  const email = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return email;
}

function credentials(formData: FormData): { email: string; password: string } | null {
  const email = emailAddress(formData.get('email'));
  const password = String(formData.get('password') ?? '');
  const passwordBytes = Buffer.byteLength(password, 'utf8');
  if (!email || passwordBytes < AUTH_PASSWORD_MIN_UTF8_BYTES || passwordBytes > AUTH_PASSWORD_MAX_UTF8_BYTES) return null;
  return { email, password };
}


export async function signInAction(formData: FormData): Promise<void> {
  const input = credentials(formData);
  if (!input) redirect('/login?error=invalid-input');
  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.auth.signInWithPassword(input);
  if (error) redirect('/login?error=sign-in-failed');
  redirect(safeNext(formData.get('next')));
}

export async function signUpAction(formData: FormData): Promise<void> {
  if (!isSignupEnabled()) redirect('/register?error=signup-closed');
  const input = credentials(formData);
  if (!input) redirect('/register?error=invalid-input');
  const baseUrl = trustedBrowserOrigin(await headers());
  if (!baseUrl) redirect('/register?error=sign-up-failed');
  const next = safeNext(formData.get('next'), '/onboarding/household');
  const callback = new URL('/auth/callback', baseUrl);
  callback.searchParams.set('next', next);
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.auth.signUp({
    ...input,
    options: { emailRedirectTo: callback.toString() },
  });
  if (error) redirect('/register?error=sign-up-failed');
  if (data.session) redirect(next);
  redirect('/login?message=confirm-email');
}

export async function requestPasswordResetAction(formData: FormData): Promise<void> {
  const email = emailAddress(formData.get('email'));
  if (!email) redirect('/forgot-password?error=invalid-input');

  const origin = trustedBrowserOrigin(await headers());
  if (!origin) redirect('/forgot-password?error=request-failed');
  const callback = new URL('/auth/callback', origin);
  callback.searchParams.set('next', '/reset-password');

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: callback.toString() });
  if (error) redirect('/forgot-password?error=request-failed');
  redirect('/forgot-password?message=link-sent');
}

export async function updatePasswordAction(formData: FormData): Promise<void> {
  const supabase = await createServerSupabaseClient();
  const { data, error: authError } = await supabase.auth.getUser();
  if (authError || !data.user) redirect('/reset-password?error=invalid-link');

  const password = String(formData.get('password') ?? '');
  const confirmation = String(formData.get('passwordConfirmation') ?? '');
  const passwordBytes = Buffer.byteLength(password, 'utf8');
  if (passwordBytes < AUTH_PASSWORD_MIN_UTF8_BYTES || passwordBytes > AUTH_PASSWORD_MAX_UTF8_BYTES || password !== confirmation) {
    redirect('/reset-password?error=invalid-input');
  }

  const { error } = await supabase.auth.updateUser({ password });
  if (error) redirect('/reset-password?error=update-failed');
  await supabase.auth.signOut({ scope: 'local' });
  redirect('/login?message=password-updated');
}

export async function signOutAction(): Promise<void> {
  const supabase = await createServerSupabaseClient();
  await supabase.auth.signOut();
  redirect('/');
}
