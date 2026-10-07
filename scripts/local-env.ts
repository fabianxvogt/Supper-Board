import { execFileSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';

const destination = '.env.local';
if (existsSync(destination) && !process.argv.includes('--replace-local')) {
  throw new Error('Existing .env.local preserved. Use --replace-local only for this isolated local Supabase project.');
}
const status = JSON.parse(execFileSync('npx', ['--no-install', 'supabase', 'status', '--output', 'json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })) as Record<string, string>;
const required = ['API_URL', 'ANON_KEY', 'SERVICE_ROLE_KEY', 'DB_URL'];
for (const name of required) {
  if (!status[name]) throw new Error(`Local Supabase status does not include ${name}. Start services first.`);
}
const api = new URL(status.API_URL);
const database = new URL(status.DB_URL);
if (!['127.0.0.1', 'localhost'].includes(api.hostname) || !['127.0.0.1', 'localhost'].includes(database.hostname)) {
  throw new Error('Refusing to generate local configuration from a non-local Supabase instance.');
}
const variables = {
  NEXT_PUBLIC_SUPABASE_URL: status.API_URL,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: status.ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY: status.SERVICE_ROLE_KEY,
  DATABASE_URL: status.DB_URL,
};
writeFileSync(destination, Object.entries(variables).map(([key, value]) => `${key}=${JSON.stringify(value)}`).join('\n') + '\n', { mode: 0o600 });
console.log('Wrote ignored .env.local for isolated local Supabase; credentials were not printed.');
