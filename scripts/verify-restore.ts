import { spawn } from 'node:child_process';
import { createWriteStream, createReadStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is required; load the isolated local .env.local.');
const parsed = new URL(url);
if (!['127.0.0.1', 'localhost'].includes(parsed.hostname) || parsed.port !== '55322') {
  throw new Error('Restore proof is restricted to this project\'s isolated local database on55322.');
}
const container = 'supabase_db_food-planner-nutrition';
const restoreName = `nutrition_restore_${randomUUID().replaceAll('-', '')}`;
await mkdir('.data', { recursive: true });
const archive = `.data/${restoreName}.dump`;
const source = new pg.Client({ connectionString: url });
await source.connect();

async function inventory(client: pg.Client) {
  const { rows: tables } = await client.query<{ schemaname: string; tablename: string }>("select schemaname,tablename from pg_tables where schemaname in ('public','auth') order by schemaname,tablename");
  const counts: Record<string, { count: string; digest: string }> = {};
  for (const { schemaname, tablename } of tables) {
    const identifier = `"${schemaname.replaceAll('"', '""')}"."${tablename.replaceAll('"', '""')}"`;
    const { rows } = await client.query<{ count: string; digest: string }>(`select count(*)::text as count, md5(coalesce(string_agg(row_hash, '' order by row_hash), '')) as digest from (select md5(to_jsonb(t)::text) as row_hash from ${identifier} t) fingerprints`);
    counts[`${schemaname}.${tablename}`] = rows[0];
  }
  const { rows: constraints } = await client.query("select c.relname,t.conname,pg_get_constraintdef(t.oid) as definition from pg_constraint t join pg_class c on c.oid=t.conrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' order by c.relname,t.conname");
  const { rows: policies } = await client.query("select schemaname,tablename,policyname,permissive,roles,cmd,qual,with_check from pg_policies where schemaname='public' order by tablename,policyname");
  const { rows: rowSecurity } = await client.query("select schemaname,tablename,rowsecurity from pg_tables where schemaname in ('public','auth') order by schemaname,tablename");
  const { rows: tablePrivileges } = await client.query("select n.nspname as schema,c.relname,c.relowner::regrole::text as owner,c.relrowsecurity,c.relforcerowsecurity,array(select permission::text from unnest(coalesce(c.relacl,acldefault(case when c.relkind='S' then 's'::\"char\" else 'r'::\"char\" end,c.relowner))) permission order by permission::text) as privileges from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','auth') and c.relkind in ('r','p','S') order by n.nspname,c.relname");
  const { rows: functions } = await client.query("select n.nspname as schema,p.proname,pg_get_function_identity_arguments(p.oid) as arguments,p.proowner::regrole::text as owner,array(select permission::text from unnest(coalesce(p.proacl,acldefault('f',p.proowner))) permission order by permission::text) as privileges,pg_get_functiondef(p.oid) as definition from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','auth','app_private') and p.prokind='f' order by n.nspname,p.proname,pg_get_function_identity_arguments(p.oid)");
  return { counts, constraints, policies, rowSecurity, tablePrivileges, functions };
}

async function streamed(command: string[], sourceFile?: string, destinationFile?: string) {
  const process = spawn('docker', ['exec', ...(sourceFile ? ['-i'] : []), container, ...command], { stdio: [sourceFile ? 'pipe' : 'ignore', destinationFile ? 'pipe' : 'ignore', 'pipe'] });
  let diagnostic = '';
  process.stderr!.on('data', (chunk: Buffer) => { diagnostic += chunk.toString(); });
  const exited = new Promise<void>((resolve, reject) => {
    process.on('error', reject);
    process.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`Database backup/restore command failed (${code}): ${diagnostic.slice(0, 400)}`)));
  });
  const streams: Promise<void>[] = [];
  if (sourceFile) streams.push(pipeline(createReadStream(sourceFile), process.stdin!));
  if (destinationFile) streams.push(pipeline(process.stdout!, createWriteStream(destinationFile, { mode: 0o600 })));
  await Promise.all([exited, ...streams]);
}

let created = false;
let restored: pg.Client | undefined;
try {
  await source.query('begin isolation level repeatable read read only');
  const { rows: snapshots } = await source.query<{ snapshot: string }>('select pg_export_snapshot() as snapshot');
  const before = await inventory(source);
  // Supabase provisions its service-internal schemas. Back up every application
  // table, Auth record and command, retaining owners and grants for a working restore.
  await streamed(['pg_dump', '-U', 'postgres', '-d', parsed.pathname.slice(1), '--snapshot', snapshots[0].snapshot, '--format=custom', '--schema=public', '--schema=auth', '--schema=app_private', '--no-publications', '--no-subscriptions'], undefined, archive);
  await source.query('commit');
  await source.query(`create database "${restoreName}" template template0`);
  created = true;
  // This local-only role preserves Auth ownership and can restore function settings.
  await streamed(['psql', '-U', 'supabase_admin', '-d', restoreName, '-v', 'ON_ERROR_STOP=1', '-c', 'drop schema public; create schema extensions; create extension pgcrypto with schema extensions; create extension pg_trgm with schema extensions; grant usage on schema extensions to postgres,anon,authenticated,service_role;']);
  await streamed(['pg_restore', '-U', 'supabase_admin', '-d', restoreName, '--exit-on-error'], archive);
  const restoredUrl = new URL(url);
  restoredUrl.pathname = `/${restoreName}`;
  restored = new pg.Client({ connectionString: restoredUrl.toString() });
  await restored.connect();
  const after = await inventory(restored);
  for (const section of Object.keys(before) as Array<keyof typeof before>) {
    if (JSON.stringify(before[section]) !== JSON.stringify(after[section])) {
      throw new Error(`Restored application/Auth ${section} differs from source.`);
    }
  }
  console.log(JSON.stringify({ result: 'passed', checked: 'public/auth row counts/content fingerprints, constraints, RLS flags/policies, owners/grants and public/auth/app_private commands', counts: after.counts, archive }, null, 2));
} finally {
  await source.query('rollback');
  await restored?.end();
  if (created) await source.query(`drop database "${restoreName}" with (force)`);
  await source.end();
}
