import { zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { inspectZip, safelyUnzip, type ZipLimits } from '../../scripts/import-bls/zip.js';

const TEST_LIMITS: ZipLimits = {
  maxArchiveBytes: 1024 * 1024,
  maxEntries: 12,
  maxEntryBytes: 512 * 1024,
  maxUncompressedBytes: 1024 * 1024,
  maxCompressionRatio: 100,
};

const textEncoder = new TextEncoder();

function findEndOfCentralDirectory(bytes: Uint8Array): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let offset = bytes.byteLength - 22; offset >= Math.max(0, bytes.byteLength - 22 - 0xffff); offset -= 1) {
    if (view.getUint32(offset, true) === 0x06054b50) return offset;
  }
  throw new Error('Test ZIP is missing its end-of-central-directory record');
}

describe('BLS ZIP validation', () => {
  it('accepts safe archives and preserves each member byte-for-byte', () => {
    const expected = textEncoder.encode('source evidence');
    const archive = zipSync({ 'workbook/data.txt': expected }, { level: 0 });
    const inspected = inspectZip(archive, TEST_LIMITS);
    const files = safelyUnzip(archive, TEST_LIMITS);

    expect(inspected).toHaveLength(1);
    expect(inspected[0].name).toBe('workbook/data.txt');
    expect(files['workbook/data.txt']).toEqual(expected);
  });
  it('accepts empty explicit directory entries without returning them as files', () => {
    const expected = textEncoder.encode('source evidence');
    const archive = zipSync({ 'workbook/': new Uint8Array(0), 'workbook/data.txt': expected }, { level: 0 });

    expect(safelyUnzip(archive, TEST_LIMITS)).toEqual({ 'workbook/data.txt': expected });
  });

  it('rejects traversal paths before decompression', () => {
    const archive = zipSync({ '../outside.txt': textEncoder.encode('not a workbook') });

    expect(() => inspectZip(archive, TEST_LIMITS)).toThrow('Unsafe ZIP member path');
  });

  it('rejects a central/local checksum that does not match inflated bytes', () => {
    const archive = zipSync({ 'workbook/data.txt': textEncoder.encode('source evidence') }, { level: 0 });
    const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);
    const endOffset = findEndOfCentralDirectory(archive);
    const centralOffset = view.getUint32(endOffset + 16, true);
    const badChecksum = (view.getUint32(centralOffset + 16, true) ^ 1) >>> 0;
    view.setUint32(14, badChecksum, true);
    view.setUint32(centralOffset + 16, badChecksum, true);

    expect(() => safelyUnzip(archive, TEST_LIMITS)).toThrow('checksum');
  });

  it('enforces decompressed-size limits before allocating member contents', () => {
    const archive = zipSync({ 'workbook/data.txt': textEncoder.encode('too large for this limit') });
    const limited: ZipLimits = { ...TEST_LIMITS, maxEntryBytes: 4 };

    expect(() => inspectZip(archive, limited)).toThrow('uncompressed size limit');
  });
});
