import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyRelease, openAdminConnection, previewImport } from './database.js';
import { KNOWN_BLS_4_0_SHA256, parseBlsArchive } from './parse.js';

const DEFAULT_ARCHIVE_PATH = fileURLToPath(new URL('../../.data/BLS_4_0_2025_DE.zip', import.meta.url));
const USAGE = `Usage:
  npm run import:bls -- validate --file PATH [--report PATH]
  npm run import:bls -- dry-run --file PATH [--report PATH]
  npm run import:bls -- apply --file PATH [--approve-hash SHA256] [--report PATH]

validate parses the archive and checks the workbook without connecting to the database.
dry-run reads the database using DATABASE_URL and reports the import plan without writes.
apply requires the exact reviewed SHA-256 (the known BLS 4.0 hash is accepted directly).`;

type Command = 'validate' | 'dry-run' | 'apply';
interface CliOptions {
  command: Command;
  archivePath: string;
  reportPath: string | null;
  approvedHash: string | null;
}

function parseArguments(args: string[]): CliOptions {
  const command = args[0];
  if (command !== 'validate' && command !== 'dry-run' && command !== 'apply') {
    throw new Error(USAGE);
  }

  let archivePath = DEFAULT_ARCHIVE_PATH;
  let reportPath: string | null = null;
  let approvedHash: string | null = null;
  const seenOptions = new Set<string>();
  for (let index = 1; index < args.length; index += 1) {
    const option = args[index];
    if (option !== '--file' && option !== '--report' && option !== '--approve-hash') {
      throw new Error(`Unknown option ${option}\n${USAGE}`);
    }
    if (seenOptions.has(option)) throw new Error(`Duplicate option ${option}`);
    seenOptions.add(option);
    const value = args[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${option}`);
    index += 1;
    if (option === '--file') archivePath = resolve(value);
    else if (option === '--report') reportPath = resolve(value);
    else approvedHash = value.toLowerCase();
  }

  if (approvedHash !== null && !/^[0-9a-f]{64}$/.test(approvedHash)) {
    throw new Error('--approve-hash must be a 64-character hexadecimal SHA-256');
  }
  if (command !== 'apply' && approvedHash !== null) {
    throw new Error('--approve-hash is only accepted by apply');
  }
  return { command, archivePath, reportPath, approvedHash };
}

async function writeReportAtomically(path: string, report: unknown): Promise<void> {
  const outputPath = resolve(path);
  const directory = dirname(outputPath);
  const temporaryPath = `${outputPath}.${process.pid}.${randomUUID()}.tmp`;
  await mkdir(directory, { recursive: true });
  try {
    await writeFile(temporaryPath, `${JSON.stringify(report, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    await rename(temporaryPath, outputPath);
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
}

export async function main(args: string[] = process.argv.slice(2)): Promise<void> {
  const options = parseArguments(args);
  const archive = await readFile(options.archivePath);
  const parsedRelease = await parseBlsArchive(archive, basename(options.archivePath));
  const report = parsedRelease.report;

  if (options.reportPath !== null) await writeReportAtomically(options.reportPath, report);
  if (!report.valid) {
    process.stdout.write(`${JSON.stringify({ command: options.command, report }, null, 2)}\n`);
    throw new Error(`Dataset validation failed: ${report.errors.join('; ')}`);
  }

  if (options.command === 'apply') {
    if (parsedRelease.sourceHash !== KNOWN_BLS_4_0_SHA256 && options.approvedHash !== parsedRelease.sourceHash) {
      throw new Error(
        `Refusing to apply unreviewed source hash ${parsedRelease.sourceHash}; pass --approve-hash with this exact hash after review`,
      );
    }
    if (options.approvedHash !== null && options.approvedHash !== parsedRelease.sourceHash) {
      throw new Error('--approve-hash does not match the archive SHA-256');
    }
    const client = await openAdminConnection();
    try {
      const result = await applyRelease(client, parsedRelease);
      process.stdout.write(`${JSON.stringify({ command: options.command, result }, null, 2)}\n`);
    } finally {
      await client.end();
    }
    return;
  }

  if (options.command === 'dry-run') {
    const client = await openAdminConnection();
    try {
      const plan = await previewImport(client, parsedRelease);
      process.stdout.write(`${JSON.stringify({ command: options.command, plan }, null, 2)}\n`);
      if (plan.action === 'blocked') throw new Error('Database preflight is blocked; inspect the reported missing seed or release conflict');
    } finally {
      await client.end();
    }
    return;
  }

  process.stdout.write(`${JSON.stringify({ command: options.command, report }, null, 2)}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`BLS import failed: ${message}\n`);
    process.exitCode = 1;
  });
}
