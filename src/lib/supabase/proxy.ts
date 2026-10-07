import { createServerClient } from '@supabase/ssr';
import type { CookieOptions } from '@supabase/ssr';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { supabaseConfiguration } from './config';

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });
  const { url, publicKey } = supabaseConfiguration();
  const retainedHeaders = new Map<string, string>();
  const retainedCookies = new Map<string, { name: string; value: string; options: CookieOptions }>();
  const client = createServerClient(url, publicKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (values, headers) => {
        for (const cookie of values) {
          request.cookies.set(cookie.name, cookie.value);
          retainedCookies.set(cookie.name, cookie);
        }
        for (const [key, value] of Object.entries(headers)) retainedHeaders.set(key, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of retainedCookies.values()) response.cookies.set(name, value, options);
        for (const [key, value] of retainedHeaders) response.headers.set(key, value);
      },
    },
  });
  // Verifies signatures and refreshes tokens; session-cookie contents alone are
  // never authority. Protected routes still verify the user on the server.
  await client.auth.getClaims();
  response.headers.set('Cache-Control', 'private, no-store');
  response.headers.set('Vary', 'Cookie');
  return response;
}
