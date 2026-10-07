export function supabaseConfiguration(): { url: string; publicKey: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publicKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !publicKey) {
    throw new Error('Supabase is not configured. Start the local database and run npm run db:env.');
  }
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(parsed.hostname))) {
    throw new Error('Supabase requires HTTPS outside local development.');
  }
  return { url, publicKey };
}
