'use client';

import { createBrowserClient } from '@supabase/ssr';
import { supabaseConfiguration } from './config';

export function createBrowserSupabaseClient() {
  const { url, publicKey } = supabaseConfiguration();
  return createBrowserClient(url, publicKey);
}
