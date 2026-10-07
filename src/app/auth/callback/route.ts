import { NextResponse, type NextRequest } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { trustedRequestOrigin } from '@/lib/supabase/auth-origin';

function safeNext(value: string | null): string {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return '/today';
  return value;
}

function authRedirect(url: URL): NextResponse {
  const response = NextResponse.redirect(url);
  response.headers.set('Cache-Control', 'no-store');
  response.headers.set('Referrer-Policy', 'no-referrer');
  return response;
}

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get('code');
  const next = safeNext(request.nextUrl.searchParams.get('next'));
  const origin = trustedRequestOrigin(request.headers);
  if (!origin) {
    const response = NextResponse.json({ error: 'invalid_callback_origin' }, { status: 400 });
    response.headers.set('Cache-Control', 'no-store');
    response.headers.set('Referrer-Policy', 'no-referrer');
    return response;
  }

  const failure = new URL(next === '/reset-password' ? '/reset-password?error=invalid-link' : '/login?error=callback-failed', origin);
  if (!code) return authRedirect(failure);

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) return authRedirect(failure);
  return authRedirect(new URL(next, origin));
}
