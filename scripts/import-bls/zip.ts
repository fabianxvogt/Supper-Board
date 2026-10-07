import { unzipSync } from 'fflate';

export interface ZipEntry {
  name: string;
  compressedSize: number;
  uncompressedSize: number;
  crc32: number;
  compressionMethod: number;
}

export interface ZipLimits {
  maxArchiveBytes: number;
  maxEntries: number;
  maxEntryBytes: number;
  maxUncompressedBytes: number;
  maxCompressionRatio: number;
}

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const UTF8_FLAG = 0x0800;
const DATA_DESCRIPTOR_FLAG = 0x0008;
const DEFLATE_OPTION_FLAGS = 0x0006;

const CRC32_TABLE = new Uint32Array(256);
for (let index = 0; index < CRC32_TABLE.length; index += 1) {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = (value & 1) !== 0 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  CRC32_TABLE[index] = value >>> 0;
}

function checksumCrc32(bytes: Uint8Array): number {
  let checksum = 0xffffffff;
  for (let index = 0; index < bytes.length; index += 1) {
    checksum = CRC32_TABLE[(checksum ^ bytes[index]!) & 0xff]! ^ (checksum >>> 8);
  }
  return (checksum ^ 0xffffffff) >>> 0;
}

export const OUTER_ZIP_LIMITS: ZipLimits = {
  maxArchiveBytes: 32 * 1024 * 1024,
  maxEntries: 12,
  maxEntryBytes: 24 * 1024 * 1024,
  maxUncompressedBytes: 64 * 1024 * 1024,
  maxCompressionRatio: 200,
};

export const WORKBOOK_ZIP_LIMITS: ZipLimits = {
  maxArchiveBytes: 24 * 1024 * 1024,
  maxEntries: 256,
  maxEntryBytes: 112 * 1024 * 1024,
  maxUncompressedBytes: 128 * 1024 * 1024,
  maxCompressionRatio: 300,
};

function readU16(view: DataView, offset: number): number {
  return view.getUint16(offset, true);
}

function readU32(view: DataView, offset: number): number {
  return view.getUint32(offset, true);
}

function assertSafePath(name: string): void {
  if (
    name.length === 0 ||
    name.startsWith('/') ||
    name.includes('\\') ||
    name.includes('\0') ||
    name.includes(':')
  ) {
    throw new Error(`Unsafe ZIP member path: ${JSON.stringify(name)}`);
  }

  const segments = name.split('/');
  const directory = segments.at(-1) === '';
  const pathSegments = directory ? segments.slice(0, -1) : segments;
  for (const segment of pathSegments) {
    if (segment.length === 0 || segment === '.' || segment === '..') {
      throw new Error(`Unsafe ZIP member path: ${JSON.stringify(name)}`);
    }
  }
}

function findEndOfCentralDirectory(bytes: Uint8Array, view: DataView): number {
  const earliestOffset = Math.max(0, bytes.length - 22 - 0xffff);
  for (let offset = bytes.length - 22; offset >= earliestOffset; offset -= 1) {
    if (readU32(view, offset) !== EOCD_SIGNATURE) continue;
    const commentLength = readU16(view, offset + 20);
    if (offset + 22 + commentLength === bytes.length) return offset;
  }
  throw new Error('ZIP end-of-central-directory record is missing or malformed');
}

export function inspectZip(bytes: Uint8Array, limits: ZipLimits): ZipEntry[] {
  if (bytes.byteLength < 22 || bytes.byteLength > limits.maxArchiveBytes) {
    throw new Error(`ZIP archive size ${bytes.byteLength} is outside the permitted limit`);
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocdOffset = findEndOfCentralDirectory(bytes, view);
  const diskNumber = readU16(view, eocdOffset + 4);
  const centralDirectoryDisk = readU16(view, eocdOffset + 6);
  const entriesOnDisk = readU16(view, eocdOffset + 8);
  const entryCount = readU16(view, eocdOffset + 10);
  const centralDirectorySize = readU32(view, eocdOffset + 12);
  const centralDirectoryOffset = readU32(view, eocdOffset + 16);

  if (
    diskNumber !== 0 ||
    centralDirectoryDisk !== 0 ||
    entriesOnDisk !== entryCount ||
    entryCount === 0xffff ||
    centralDirectorySize === 0xffffffff ||
    centralDirectoryOffset === 0xffffffff ||
    entryCount > limits.maxEntries ||
    centralDirectoryOffset + centralDirectorySize !== eocdOffset
  ) {
    throw new Error('Multi-disk, ZIP64, oversized, or malformed ZIP archives are not supported');
  }

  const entries: ZipEntry[] = [];
  const seen = new Set<string>();
  const localRecordRanges: Array<{ start: number; end: number; name: string }> = [];
  let totalUncompressedBytes = 0;
  let offset = centralDirectoryOffset;

  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > eocdOffset || readU32(view, offset) !== CENTRAL_SIGNATURE) {
      throw new Error(`Malformed ZIP central directory entry ${index + 1}`);
    }

    const madeBy = readU16(view, offset + 4);
    const flags = readU16(view, offset + 8);
    const compressionMethod = readU16(view, offset + 10);
    const crc32 = readU32(view, offset + 16);
    const compressedSize = readU32(view, offset + 20);
    const uncompressedSize = readU32(view, offset + 24);
    const nameLength = readU16(view, offset + 28);
    const extraLength = readU16(view, offset + 30);
    const commentLength = readU16(view, offset + 32);
    const diskStart = readU16(view, offset + 34);
    const externalAttributes = readU32(view, offset + 38);
    const localHeaderOffset = readU32(view, offset + 42);
    const recordEnd = offset + 46 + nameLength + extraLength + commentLength;

    if (
      recordEnd > eocdOffset ||
      diskStart !== 0 ||
      compressedSize === 0xffffffff ||
      uncompressedSize === 0xffffffff ||
      localHeaderOffset === 0xffffffff ||
      (flags & 0x0001) !== 0 ||
      (flags & ~(UTF8_FLAG | DATA_DESCRIPTOR_FLAG | DEFLATE_OPTION_FLAGS)) !== 0 ||
      (compressionMethod !== 0 && compressionMethod !== 8)
    ) {
      throw new Error(`Unsupported or malformed ZIP member at index ${index + 1}`);
    }

    const filenameBytes = bytes.subarray(offset + 46, offset + 46 + nameLength);
    let name: string;
    try {
      name = new TextDecoder('utf-8', { fatal: true }).decode(filenameBytes);
    } catch {
      throw new Error(`ZIP member ${index + 1} has an invalid UTF-8 path`);
    }
    assertSafePath(name);
    if (seen.has(name)) throw new Error(`Duplicate ZIP member path: ${name}`);
    seen.add(name);

    const isDirectory = name.endsWith('/');
    const hostOperatingSystem = madeBy >>> 8;
    const unixMode = externalAttributes >>> 16;
    const fileType = unixMode & 0o170000;
    if (
      (hostOperatingSystem === 3 || hostOperatingSystem === 19) &&
      fileType !== 0 &&
      fileType !== (isDirectory ? 0o040000 : 0o100000)
    ) {
      throw new Error(`ZIP member is not a regular file or directory: ${name}`);
    }
    if (isDirectory && (compressedSize !== 0 || uncompressedSize !== 0)) {
      throw new Error(`ZIP directory has a data payload: ${name}`);
    }

    if (uncompressedSize > limits.maxEntryBytes) {
      throw new Error(`ZIP member exceeds the uncompressed size limit: ${name}`);
    }
    if (
      uncompressedSize > 0 &&
      (compressedSize === 0 || uncompressedSize / compressedSize > limits.maxCompressionRatio)
    ) {
      throw new Error(`ZIP member exceeds the compression-ratio limit: ${name}`);
    }

    totalUncompressedBytes += uncompressedSize;
    if (totalUncompressedBytes > limits.maxUncompressedBytes) {
      throw new Error('ZIP archive exceeds the total uncompressed size limit');
    }

    if (
      localHeaderOffset + 30 > centralDirectoryOffset ||
      readU32(view, localHeaderOffset) !== LOCAL_SIGNATURE
    ) {
      throw new Error(`ZIP local header is missing for member: ${name}`);
    }
    const localFlags = readU16(view, localHeaderOffset + 6);
    const localMethod = readU16(view, localHeaderOffset + 8);
    const localCrc32 = readU32(view, localHeaderOffset + 14);
    const localCompressedSize = readU32(view, localHeaderOffset + 18);
    const localUncompressedSize = readU32(view, localHeaderOffset + 22);
    if (localFlags !== flags || localMethod !== compressionMethod) {
      throw new Error(`ZIP local and central metadata differ for: ${name}`);
    }
    const localNameLength = readU16(view, localHeaderOffset + 26);
    const localExtraLength = readU16(view, localHeaderOffset + 28);
    const localNameStart = localHeaderOffset + 30;
    const localNameEnd = localNameStart + localNameLength;
    const payloadStart = localNameEnd + localExtraLength;
    if (payloadStart > centralDirectoryOffset) {
      throw new Error(`Malformed ZIP local header for member: ${name}`);
    }
    let localName: string;
    try {
      localName = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(localNameStart, localNameEnd));
    } catch {
      throw new Error(`ZIP local path has invalid UTF-8: ${name}`);
    }
    if (localName !== name) throw new Error(`ZIP local and central paths differ for: ${name}`);

    const payloadEnd = payloadStart + compressedSize;
    if (payloadEnd > centralDirectoryOffset) {
      throw new Error(`ZIP member payload overlaps the central directory: ${name}`);
    }
    let localRecordEnd = payloadEnd;
    if ((flags & DATA_DESCRIPTOR_FLAG) !== 0) {
      if (
        (localCrc32 !== 0 && localCrc32 !== crc32) ||
        (localCompressedSize !== 0 && localCompressedSize !== compressedSize) ||
        (localUncompressedSize !== 0 && localUncompressedSize !== uncompressedSize)
      ) {
        throw new Error(`ZIP descriptor metadata conflicts with its local header: ${name}`);
      }
      let descriptorLength = 0;
      if (
        payloadEnd + 16 <= centralDirectoryOffset &&
        readU32(view, payloadEnd) === 0x08074b50 &&
        readU32(view, payloadEnd + 4) === crc32 &&
        readU32(view, payloadEnd + 8) === compressedSize &&
        readU32(view, payloadEnd + 12) === uncompressedSize
      ) {
        descriptorLength = 16;
      } else if (
        payloadEnd + 12 <= centralDirectoryOffset &&
        readU32(view, payloadEnd) === crc32 &&
        readU32(view, payloadEnd + 4) === compressedSize &&
        readU32(view, payloadEnd + 8) === uncompressedSize
      ) {
        descriptorLength = 12;
      }
      if (descriptorLength === 0) throw new Error(`ZIP data descriptor is missing or inconsistent: ${name}`);
      localRecordEnd += descriptorLength;
    } else if (
      localCrc32 !== crc32 ||
      localCompressedSize !== compressedSize ||
      localUncompressedSize !== uncompressedSize
    ) {
      throw new Error(`ZIP local and central sizes or checksums differ for: ${name}`);
    }
    for (const range of localRecordRanges) {
      if (localHeaderOffset < range.end && localRecordEnd > range.start) {
        throw new Error(`ZIP local records overlap: ${name} and ${range.name}`);
      }
    }
    localRecordRanges.push({ start: localHeaderOffset, end: localRecordEnd, name });

    entries.push({ name, compressedSize, uncompressedSize, crc32, compressionMethod });
    offset = recordEnd;
  }

  if (offset !== centralDirectoryOffset + centralDirectorySize) {
    throw new Error('ZIP central directory size does not match its entries');
  }

  return entries;
}

export function safelyUnzip(bytes: Uint8Array, limits: ZipLimits): Record<string, Uint8Array> {
  const entries = inspectZip(bytes, limits);
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes);
  } catch {
    throw new Error('ZIP decompression failed');
  }

  const expectedNames: string[] = [];
  for (const entry of entries) expectedNames.push(entry.name);
  const actualNames = Object.keys(files);
  actualNames.sort();
  expectedNames.sort();
  if (actualNames.length !== expectedNames.length) {
    throw new Error('ZIP decompressor member list differs from its validated central directory');
  }
  for (let index = 0; index < actualNames.length; index += 1) {
    if (actualNames[index] !== expectedNames[index]) {
      throw new Error('ZIP decompressor member list differs from its validated central directory');
    }
  }

  for (const entry of entries) {
    const member = files[entry.name];
    if (member === undefined || member.byteLength !== entry.uncompressedSize) {
      throw new Error(`ZIP member size differs from its central directory: ${entry.name}`);
    }
    if (checksumCrc32(member) !== entry.crc32) {
      throw new Error(`ZIP member checksum differs from its central directory: ${entry.name}`);
    }
    if (entry.name.endsWith('/')) {
      if (entry.uncompressedSize !== 0) throw new Error(`ZIP directory entry contains data: ${entry.name}`);
      delete files[entry.name];
    }
  }

  return files;
}
