import 'server-only';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { supabaseConfiguration } from './config';

export async function createServerSupabaseClient() {
  const { url, publicKey } = supabaseConfiguration();
  const store = await cookies();
  return createServerClient(url, publicKey, {
    global: { fetch: (input, init) => fetch(input, { ...init, cache: 'no-store' }) },
    cookies: {
      getAll: () => store.getAll(),
      setAll: (values) => {
        // Server Components cannot write cookies. The request proxy refreshes and
        // forwards them before rendering; actions and route handlers can write.
        try {
          for (const { name, value, options } of values) store.set(name, value, options);
        } catch {
          // Official SSR pattern: readonly rendering relies on the proxy response.
        }
      },
    },
  });
}

export async function getVerifiedUser() {
  const client = await createServerSupabaseClient();
  const { data, error } = await client.auth.getUser();
  if (error) {
    if (error.name === 'AuthSessionMissingError' || error.status === 401 || error.status === 403) return null;
    throw new Error('Authentication verification is unavailable. Please try again.');
  }
  return data.user;
}
