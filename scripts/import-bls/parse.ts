import { createHash } from 'node:crypto';
import ExcelJS from 'exceljs';
import { BLS_NUTRIENT_MAPPINGS } from '../../src/domain/nutrient-mappings.js';
import { BLS_SOURCE_CATEGORY_BY_SOURCE_CODE } from './categories.js';
import { inspectZip, OUTER_ZIP_LIMITS, safelyUnzip, WORKBOOK_ZIP_LIMITS, type ZipEntry } from './zip.js';

export const BLS_SOURCE_ID = '00000000-0000-4000-8000-000000000001';
export const BLS_SOURCE_CODE = 'bls_4_0';
export const BLS_LICENSE = 'CC BY 4.0';
export const BLS_ATTRIBUTION =
  'Bundeslebensmittelschlüssel (BLS) 4.0, Max Rubner-Institut; source: https://doi.org/10.25826/Data20251217-134202-0';
export const KNOWN_BLS_4_0_SHA256 =
  '12b7a6ba62807ec9b301eb276f897dc85f99b2292311618dec3749a12d984c91';

export type NutrientSourceStatus =
  | 'numeric'
  | 'explicit_zero'
  | 'trace'
  | 'below_limit'
  | 'missing'
  | 'source_not_present'
  | 'unsupported_mapping';

export interface SourceComponent {
  index: number;
  code: string;
  nameDe: string;
  nameEn: string;
  unit: string;
  groupDe: string;
  groupEn: string;
  formula: string;
  formulaApplication: string;
}

export interface SourceColumnMapping {
  component: SourceComponent;
  valueColumn: number;
  methodColumn: number;
  referenceColumn: number;
}

export interface NutrientObservation {
  componentCode: string;
  rawValue: string;
  normalizedAmount: string | null;
  valueStatus: NutrientSourceStatus;
  sourceMethod: string;
  sourceReference: string;
}

export interface ParsedFood {
  sourceFoodCode: string;
  nameDe: string;
  nameEn: string;
  sourceNotes: string;
  sourceCategoryCode: string;
  nutrients: NutrientObservation[];
}

export interface ArchiveFileReport {
  path: string;
  compressedBytes: number;
  uncompressedBytes: number;
}

export interface BlsImportReport {
  reportVersion: 1;
  source: {
    code: string;
    releaseCode: string;
    version: string;
    sha256: string;
    license: string;
    attribution: string;
  };
  archive: {
    sizeBytes: number;
    files: ArchiveFileReport[];
  };
  workbook: {
    foodCount: number;
    componentCount: number;
    headerCount: number;
    valueFieldCount: number;
    completeHeaderMapping: boolean;
    mappedComponentCount: number;
    unmappedComponentCount: number;
    duplicateFoodCodes: number;
    foodGroups: Record<string, number>;
  };
  valueStatusCounts: Record<string, number>;
  sourceMethodCounts: Record<string, number>;
  negativeValueCount: number;
  unknownMarkerCount: number;
  unknownMarkerSamples: Array<{ foodCode: string; componentCode: string; rawValue: string }>;
  exactKnownReleaseRegression: {
    applicable: boolean;
    passed: boolean;
    expected?: Record<string, number>;
    differences: string[];
  };
  valid: boolean;
  errors: string[];
}

export interface ParsedBlsRelease {
  fileName: string;
  sourceHash: string;
  releaseCode: string;
  version: string;
  report: BlsImportReport;
  components: SourceComponent[];
  columnMappings: SourceColumnMapping[];
  foodsWorksheet: ExcelJS.Worksheet;
  worksheetXml: string;
  worksheetRowCount: number;
}

const UNIT_CODES: Record<string, true> = {
  g: true,
  mg: true,
  'µg': true,
  kJ: true,
  kcal: true,
};

const canonicalCodes: Record<string, string> = Object.create(null) as Record<string, string>;
for (const [componentCode, mapping] of Object.entries(BLS_NUTRIENT_MAPPINGS)) {
  canonicalCodes[componentCode] = mapping.canonicalNutrientId;
}
export const CANONICAL_NUTRIENT_CODE_BY_COMPONENT: Readonly<Record<string, string>> = Object.freeze(canonicalCodes);

const EXPECTED_MARKER_COUNTS: Readonly<Record<string, number>> = {
  numeric_nonzero: 656320,
  numeric_zero: 213181,
  dash_missing: 110083,
  blank_missing: 59,
  below_loq: 746,
  below_lod: 2733,
  below_lod_or_loq: 392,
  trace: 1806,
};

const EXPECTED_KNOWN_RELEASE = {
  foodCount: 7140,
  componentCount: 138,
  headerCount: 418,
  valueFieldCount: 985320,
};

function xmlAttributes(source: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  const pattern = /([A-Za-z_:][A-Za-z0-9_.:-]*)="([^"]*)"/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) {
    const value = match[2];
    if (value.includes('&')) throw new Error('Unexpected entity in XLSX XML attribute');
    attributes[match[1]] = value;
  }
  return attributes;
}

function getTextCell(cell: ExcelJS.Cell, label: string): string {
  const value = cell.value;
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  throw new Error(`${label} must be a plain text cell`);
}

function getNumberCell(cell: ExcelJS.Cell, label: string): number {
  const value = cell.value;
  if (typeof value === 'number' && Number.isSafeInteger(value)) return value;
  throw new Error(`${label} must be a safe integer cell`);
}

function resolveWorksheetXml(files: Record<string, Uint8Array>, expectedName: string): string {
  const workbookBytes = files['xl/workbook.xml'];
  const relationshipsBytes = files['xl/_rels/workbook.xml.rels'];
  if (!workbookBytes || !relationshipsBytes) throw new Error('XLSX workbook metadata is missing');

  const decoder = new TextDecoder('utf-8', { fatal: true });
  const workbookXml = decoder.decode(workbookBytes);
  const relationshipsXml = decoder.decode(relationshipsBytes);
  if (/<!DOCTYPE|<!ENTITY/i.test(workbookXml + relationshipsXml)) {
    throw new Error('DTD and entity declarations are not allowed in XLSX metadata');
  }

  const sheetTags = workbookXml.match(/<sheet\b[^>]*\/?\s*>/g) ?? [];
  let matchingRelationshipId: string | null = null;
  for (const tag of sheetTags) {
    const attributes = xmlAttributes(tag);
    if (attributes.name === expectedName) {
      matchingRelationshipId = attributes['r:id'] ?? null;
      break;
    }
  }
  if (!matchingRelationshipId) throw new Error(`XLSX sheet ${expectedName} is missing`);

  const relationshipTags = relationshipsXml.match(/<Relationship\b[^>]*\/?\s*>/g) ?? [];
  let target: string | null = null;
  for (const tag of relationshipTags) {
    const attributes = xmlAttributes(tag);
    if (attributes.Id !== matchingRelationshipId) continue;
    if (attributes.TargetMode === 'External') throw new Error('External XLSX worksheet links are not allowed');
    target = attributes.Target ?? null;
    break;
  }
  if (!target || target.startsWith('/') || target.includes('\\') || target.includes('..')) {
    throw new Error('XLSX worksheet relationship has an unsafe target');
  }

  const worksheetPath = target.startsWith('xl/') ? target : `xl/${target}`;
  const worksheetBytes = files[worksheetPath];
  if (!worksheetBytes) throw new Error(`XLSX worksheet data is missing: ${worksheetPath}`);
  const worksheetXml = decoder.decode(worksheetBytes);
  if (/<!DOCTYPE|<!ENTITY/i.test(worksheetXml)) {
    throw new Error('DTD and entity declarations are not allowed in worksheet XML');
  }
  return worksheetXml;
}

function columnNumberFromCellAddress(address: string): { column: number; row: number } {
  const match = /^([A-Z]+)([1-9][0-9]*)$/.exec(address);
  if (!match) throw new Error(`Invalid XLSX cell address: ${address}`);

  let column = 0;
  for (const character of match[1]) {
    column = column * 26 + character.charCodeAt(0) - 64;
  }
  return { column, row: Number(match[2]) };
}

function* rawNumericRows(worksheetXml: string): Generator<{ row: number; values: Map<number, string> }> {
  const rowPattern = /<row\b([^>]*)>([\s\S]*?)<\/row>/g;
  let rowMatch: RegExpExecArray | null;
  while ((rowMatch = rowPattern.exec(worksheetXml)) !== null) {
    const rowAttributes = xmlAttributes(rowMatch[1]);
    const rowNumber = Number(rowAttributes.r);
    if (!Number.isSafeInteger(rowNumber) || rowNumber < 1) {
      throw new Error('XLSX worksheet contains an invalid row number');
    }

    const rawValues = new Map<number, string>();
    const cellPattern = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
    let cellMatch: RegExpExecArray | null;
    while ((cellMatch = cellPattern.exec(rowMatch[2])) !== null) {
      const attributes = xmlAttributes(cellMatch[1]);
      if (!attributes.r) throw new Error('XLSX cell is missing its coordinate');
      const coordinate = columnNumberFromCellAddress(attributes.r);
      if (coordinate.row !== rowNumber || coordinate.column < 4 || coordinate.column > 417) continue;
      if (/<f\b/.test(cellMatch[2] ?? '')) throw new Error('Formula cells are not allowed in BLS source workbooks');
      const cellType = attributes.t;
      if (cellType !== undefined && cellType !== 'n') continue;

      const valueMatch = /<v>([^<]*)<\/v>/.exec(cellMatch[2] ?? '');
      if (valueMatch) {
        const rawValue = valueMatch[1];
        if (!/^-?(?:\d+(?:\.\d*)?|\.\d+)(?:[Ee][+-]?\d+)?$/.test(rawValue)) {
          throw new Error(`Invalid raw numeric XLSX value in cell ${attributes.r}`);
        }
        rawValues.set(coordinate.column, rawValue);
      }
    }

    yield { row: rowNumber, values: rawValues };
  }
}

function parseComponents(workbook: ExcelJS.Workbook): SourceComponent[] {
  if (workbook.worksheets.length !== 1 || workbook.worksheets[0].name !== 'BLS_4_0') {
    throw new Error('Unexpected BLS components worksheet layout');
  }
  const worksheet = workbook.worksheets[0];
  const expectedHeaders = [
    'Index',
    'Nährstoffcode / Component code',
    'Nährstoffbezeichnung',
    'Component name',
    'Einheit / Unit',
    'Nährstoffgruppe',
    'Component group',
    'Formeln / Formula',
    'Formelanwendung / Formula application',
  ];
  for (let index = 0; index < expectedHeaders.length; index += 1) {
    const header = getTextCell(worksheet.getRow(1).getCell(index + 1), `Components header ${index + 1}`);
    if (header !== expectedHeaders[index]) {
      throw new Error(`Unexpected components header ${index + 1}: ${JSON.stringify(header)}`);
    }
  }

  const components: SourceComponent[] = [];
  const seenCodes = new Set<string>();
  for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    const indexValue = row.getCell(1).value;
    const codeText = getTextCell(row.getCell(2), `Component code at row ${rowNumber}`);
    if (indexValue === null || indexValue === undefined) {
      if (codeText.length > 0) throw new Error(`Component code has no index at row ${rowNumber}`);
      continue;
    }

    const index = getNumberCell(row.getCell(1), `Component index at row ${rowNumber}`);
    const code = codeText;
    const nameDe = getTextCell(row.getCell(3), `German component name at row ${rowNumber}`);
    const nameEn = getTextCell(row.getCell(4), `English component name at row ${rowNumber}`);
    const unit = getTextCell(row.getCell(5), `Component unit at row ${rowNumber}`);
    const groupDe = getTextCell(row.getCell(6), `German component group at row ${rowNumber}`);
    const groupEn = getTextCell(row.getCell(7), `English component group at row ${rowNumber}`);
    const formula = getTextCell(row.getCell(8), `Component formula at row ${rowNumber}`);
    const formulaApplication = getTextCell(row.getCell(9), `Component formula application at row ${rowNumber}`);

    if (
      !/^[A-Z][A-Z0-9:]*$/.test(code) ||
      seenCodes.has(code) ||
      nameDe.length === 0 ||
      nameEn.length === 0 ||
      !UNIT_CODES[unit] ||
      groupDe.length === 0 ||
      groupEn.length === 0
    ) {
      throw new Error(`Invalid or duplicate BLS component row ${rowNumber}`);
    }
    seenCodes.add(code);
    components.push({ index, code, nameDe, nameEn, unit, groupDe, groupEn, formula, formulaApplication });
  }

  for (let index = 0; index < components.length; index += 1) {
    if (components[index].index !== index + 1) {
      throw new Error('BLS component indexes must be unique and sequential from 1');
    }
  }
  return components;
}

function mapHeaders(worksheet: ExcelJS.Worksheet, components: SourceComponent[]): SourceColumnMapping[] {
  const expectedFixedHeaders = ['BLS Code', 'Lebensmittelbezeichnung', 'Food name'];
  for (let index = 0; index < expectedFixedHeaders.length; index += 1) {
    const header = getTextCell(worksheet.getRow(1).getCell(index + 1), `Food header ${index + 1}`);
    if (header !== expectedFixedHeaders[index]) {
      throw new Error(`Unexpected BLS identity header ${index + 1}: ${JSON.stringify(header)}`);
    }
  }

  const expectedColumnCount = components.length * 3 + 4;
  if (worksheet.columnCount !== expectedColumnCount) {
    throw new Error(`Expected ${expectedColumnCount} BLS columns, found ${worksheet.columnCount}`);
  }
  const mappings: SourceColumnMapping[] = [];
  const codesByColumn = new Set<number>();
  for (let index = 0; index < components.length; index += 1) {
    const component = components[index];
    const valueColumn = index * 3 + 4;
    const methodColumn = valueColumn + 1;
    const referenceColumn = valueColumn + 2;
    const valueHeader = getTextCell(worksheet.getRow(1).getCell(valueColumn), `Value header ${valueColumn}`);
    const methodHeader = getTextCell(worksheet.getRow(1).getCell(methodColumn), `Method header ${methodColumn}`);
    const referenceHeader = getTextCell(worksheet.getRow(1).getCell(referenceColumn), `Reference header ${referenceColumn}`);

    if (
      !valueHeader.startsWith(`${component.code} `) ||
      !valueHeader.endsWith(`[${component.unit}/100g]`) ||
      methodHeader !== `${component.code} Datenherkunft` ||
      referenceHeader !== `${component.code} Referenz`
    ) {
      throw new Error(`BLS columns do not match component ${component.code}`);
    }
    codesByColumn.add(valueColumn);
    codesByColumn.add(methodColumn);
    codesByColumn.add(referenceColumn);
    mappings.push({ component, valueColumn, methodColumn, referenceColumn });
  }

  const lastHeader = getTextCell(
    worksheet.getRow(1).getCell(expectedColumnCount),
    `Final BLS header ${expectedColumnCount}`,
  );
  if (lastHeader !== 'Hinweis' || codesByColumn.size !== components.length * 3) {
    throw new Error('BLS final note column or full component header mapping is invalid');
  }
  return mappings;
}

function classifyValue(
  foodCode: string,
  mapping: SourceColumnMapping,
  row: ExcelJS.Row,
  rawValues: Map<number, string>,
  report: BlsImportReport,
  trackValidationCounts: boolean,
): NutrientObservation {
  const cell = row.getCell(mapping.valueColumn);
  const value = cell.value;
  const canonicalCode = CANONICAL_NUTRIENT_CODE_BY_COMPONENT[mapping.component.code];
  let rawValue = '';
  let normalizedAmount: string | null = null;
  let valueStatus: NutrientSourceStatus;

  if (typeof value === 'number') {
    const sourceNumeric = rawValues.get(mapping.valueColumn);
    if (sourceNumeric === undefined || Number(sourceNumeric) !== value || !Number.isFinite(value)) {
      throw new Error(`Missing or inconsistent raw numeric cell for ${foodCode}/${mapping.component.code}`);
    }
    rawValue = sourceNumeric;
    normalizedAmount = sourceNumeric;
    if (trackValidationCounts && value < 0) report.negativeValueCount += 1;
    if (value === 0) {
      valueStatus = canonicalCode === undefined ? 'unsupported_mapping' : 'explicit_zero';
      if (trackValidationCounts) report.valueStatusCounts.numeric_zero += 1;
    } else {
      valueStatus = canonicalCode === undefined ? 'unsupported_mapping' : 'numeric';
      if (trackValidationCounts) report.valueStatusCounts.numeric_nonzero += 1;
    }
  } else if (value === null || value === undefined || typeof value === 'string') {
    rawValue = typeof value === 'string' ? value : '';
    const normalizedMarker = rawValue.trim().toUpperCase();
    if (normalizedMarker.length === 0 || normalizedMarker === '-') {
      valueStatus = 'missing';
      if (normalizedMarker.length === 0) {
        if (trackValidationCounts) report.valueStatusCounts.blank_missing += 1;
      } else if (trackValidationCounts) {
        report.valueStatusCounts.dash_missing += 1;
      }
    } else if (normalizedMarker === 'TR') {
      valueStatus = 'trace';
      if (trackValidationCounts) report.valueStatusCounts.trace += 1;
    } else if (normalizedMarker === '<LOD') {
      valueStatus = 'below_limit';
      if (trackValidationCounts) report.valueStatusCounts.below_lod += 1;
    } else if (normalizedMarker === '<LOQ') {
      valueStatus = 'below_limit';
      if (trackValidationCounts) report.valueStatusCounts.below_loq += 1;
    } else if (normalizedMarker === '<LOD OR <LOQ') {
      valueStatus = 'below_limit';
      if (trackValidationCounts) report.valueStatusCounts.below_lod_or_loq += 1;
    } else {
      if (trackValidationCounts) {
        report.unknownMarkerCount += 1;
        if (report.unknownMarkerSamples.length < 100) {
          report.unknownMarkerSamples.push({
            foodCode,
            componentCode: mapping.component.code,
            rawValue,
          });
        }
      }
      valueStatus = canonicalCode === undefined ? 'unsupported_mapping' : 'missing';
    }
  } else {
    throw new Error(`Unsupported XLSX value in ${foodCode}/${mapping.component.code}`);
  }

  const sourceMethod = getTextCell(row.getCell(mapping.methodColumn), `Source method ${foodCode}/${mapping.component.code}`);
  const sourceReference = getTextCell(row.getCell(mapping.referenceColumn), `Source reference ${foodCode}/${mapping.component.code}`);
  if (trackValidationCounts && sourceMethod.length > 0) {
    if (report.sourceMethodCounts[sourceMethod] === undefined) report.sourceMethodCounts[sourceMethod] = 0;
    report.sourceMethodCounts[sourceMethod] += 1;
  }
  return {
    componentCode: mapping.component.code,
    rawValue,
    normalizedAmount,
    valueStatus,
    sourceMethod,
    sourceReference,
  };
}

export function* iterateFoods(
  release: ParsedBlsRelease,
  trackValidationCounts = false,
): Generator<ParsedFood> {
  const rawRows = rawNumericRows(release.worksheetXml);
  let rawRow = rawRows.next();

  for (let rowNumber = 2; rowNumber <= release.worksheetRowCount; rowNumber += 1) {
    while (!rawRow.done && rawRow.value.row < rowNumber) rawRow = rawRows.next();
    const rawValues = !rawRow.done && rawRow.value.row === rowNumber ? rawRow.value.values : new Map<number, string>();
    const row = release.foodsWorksheet.getRow(rowNumber);
    const sourceFoodCode = getTextCell(row.getCell(1), `BLS food code at row ${rowNumber}`);
    const nameDe = getTextCell(row.getCell(2), `German food name at row ${rowNumber}`);
    const nameEn = getTextCell(row.getCell(3), `English food name at row ${rowNumber}`);
    if (!/^[A-Z][A-Z0-9]{6}$/.test(sourceFoodCode) || nameDe.trim().length === 0 || nameEn.trim().length === 0) {
      throw new Error(`Invalid BLS food identity at row ${rowNumber}`);
    }

    const nutrients: NutrientObservation[] = [];
    for (const columnMapping of release.columnMappings) {
      nutrients.push(classifyValue(sourceFoodCode, columnMapping, row, rawValues, release.report, trackValidationCounts));
    }
    const sourceNotes = getTextCell(row.getCell(release.foodsWorksheet.columnCount), `Food note at row ${rowNumber}`);
    yield {
      sourceFoodCode,
      nameDe,
      nameEn,
      sourceNotes,
      sourceCategoryCode: sourceFoodCode[0],
      nutrients,
    };
    rawRow = rawRows.next();
  }
}

function makeEmptyReport(
  sourceHash: string,
  releaseCode: string,
  version: string,
  archiveSize: number,
  entries: ZipEntry[],
): BlsImportReport {
  const files: ArchiveFileReport[] = [];
  for (const entry of entries) {
    if (entry.name.endsWith('/')) continue;
    files.push({
      path: entry.name,
      compressedBytes: entry.compressedSize,
      uncompressedBytes: entry.uncompressedSize,
    });
  }

  const foodGroups: Record<string, number> = {};
  for (const category of Object.values(BLS_SOURCE_CATEGORY_BY_SOURCE_CODE)) {
    if (category.sourceCode !== '?') foodGroups[category.code] = 0;
  }
  foodGroups.unassigned = 0;
  const valueStatusCounts: Record<string, number> = {
    numeric_nonzero: 0,
    numeric_zero: 0,
    dash_missing: 0,
    blank_missing: 0,
    below_loq: 0,
    below_lod: 0,
    below_lod_or_loq: 0,
    trace: 0,
  };
  return {
    reportVersion: 1,
    source: {
      code: BLS_SOURCE_CODE,
      releaseCode,
      version,
      sha256: sourceHash,
      license: BLS_LICENSE,
      attribution: BLS_ATTRIBUTION,
    },
    archive: { sizeBytes: archiveSize, files },
    workbook: {
      foodCount: 0,
      componentCount: 0,
      headerCount: 0,
      valueFieldCount: 0,
      completeHeaderMapping: false,
      mappedComponentCount: 0,
      unmappedComponentCount: 0,
      duplicateFoodCodes: 0,
      foodGroups,
    },
    valueStatusCounts,
    sourceMethodCounts: {},
    negativeValueCount: 0,
    unknownMarkerCount: 0,
    unknownMarkerSamples: [],
    exactKnownReleaseRegression: { applicable: false, passed: true, differences: [] },
    valid: true,
    errors: [],
  };
}

function compareKnownRelease(report: BlsImportReport): void {
  const known = report.source.sha256 === KNOWN_BLS_4_0_SHA256;
  report.exactKnownReleaseRegression.applicable = known;
  if (!known) return;

  const expected: Record<string, number> = {
    ...EXPECTED_KNOWN_RELEASE,
    ...EXPECTED_MARKER_COUNTS,
  };
  report.exactKnownReleaseRegression.expected = expected;
  const differences: string[] = [];
  for (const key of Object.keys(EXPECTED_KNOWN_RELEASE)) {
    const observed = report.workbook[key as keyof typeof report.workbook];
    if (observed !== EXPECTED_KNOWN_RELEASE[key as keyof typeof EXPECTED_KNOWN_RELEASE]) {
      differences.push(`${key}: expected ${EXPECTED_KNOWN_RELEASE[key as keyof typeof EXPECTED_KNOWN_RELEASE]}, observed ${String(observed)}`);
    }
  }
  for (const key of Object.keys(EXPECTED_MARKER_COUNTS)) {
    if (report.valueStatusCounts[key] !== EXPECTED_MARKER_COUNTS[key]) {
      differences.push(`${key}: expected ${EXPECTED_MARKER_COUNTS[key]}, observed ${report.valueStatusCounts[key]}`);
    }
  }
  report.exactKnownReleaseRegression.differences = differences;
  report.exactKnownReleaseRegression.passed = differences.length === 0;
  if (differences.length > 0) report.errors.push(...differences);
}

function excelSourceBytes(bytes: Uint8Array): ArrayBuffer {
  if (bytes.buffer instanceof ArrayBuffer && bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength) {
    return bytes.buffer;
  }
  const source = new Uint8Array(bytes.byteLength);
  source.set(bytes);
  return source.buffer;
}

export async function parseBlsArchive(bytes: Uint8Array, fileName: string): Promise<ParsedBlsRelease> {
  const sourceHash = createHash('sha256').update(bytes).digest('hex');
  const archiveEntries = inspectZip(bytes, OUTER_ZIP_LIMITS);
  const outerEntries = safelyUnzip(bytes, OUTER_ZIP_LIMITS);
  const entryList = Object.keys(outerEntries);
  if (entryList.length !== 3) throw new Error(`Expected exactly three official BLS archive files, found ${entryList.length}`);

  const inputRoot = entryList[0].split('/')[0];
  const releaseName = /^BLS_(\d+_\d+)_(\d{4})_DE$/.exec(inputRoot);
  if (!releaseName) throw new Error(`Unexpected BLS archive root directory: ${inputRoot}`);
  const version = releaseName[1].replace('_', '.');
  const releaseCode = inputRoot;
  const versionCode = releaseName[1];
  const year = releaseName[2];
  const expectedDataPath = `${inputRoot}/BLS_${versionCode}_Daten_${year}_DE.xlsx`;
  const expectedComponentPath = `${inputRoot}/BLS_${versionCode}_Components_DE_EN.xlsx`;
  const expectedDocumentationPath = `${inputRoot}/BLS_${versionCode}_Dokumentation_DE.pdf`;
  const expectedArchivePaths = [expectedDataPath, expectedComponentPath, expectedDocumentationPath].sort();
  const actualArchivePaths = [...entryList].sort();
  for (let index = 0; index < expectedArchivePaths.length; index += 1) {
    if (actualArchivePaths[index] !== expectedArchivePaths[index]) {
      throw new Error(`Unexpected BLS archive member ${actualArchivePaths[index] ?? '(missing)'}`);
    }
  }

  const dataBytes = outerEntries[expectedDataPath];
  const componentBytes = outerEntries[expectedComponentPath];
  const workbookFiles = safelyUnzip(dataBytes, WORKBOOK_ZIP_LIMITS);
  const componentFiles = safelyUnzip(componentBytes, WORKBOOK_ZIP_LIMITS);
  for (const path of Object.keys(workbookFiles)) {
    if (path === 'xl/vbaProject.bin' || path.includes('externalLinks')) {
      throw new Error(`Macros and external links are not allowed in XLSX: ${path}`);
    }
  }
  for (const path of Object.keys(componentFiles)) {
    if (path === 'xl/vbaProject.bin' || path.includes('externalLinks')) {
      throw new Error(`Macros and external links are not allowed in XLSX: ${path}`);
    }
  }

  const componentWorkbook = new ExcelJS.Workbook();
  await componentWorkbook.xlsx.load(excelSourceBytes(componentBytes));
  const components = parseComponents(componentWorkbook);
  const foodsWorkbook = new ExcelJS.Workbook();
  await foodsWorkbook.xlsx.load(excelSourceBytes(dataBytes));
  if (foodsWorkbook.worksheets.length !== 1 || foodsWorkbook.worksheets[0].name !== `BLS_${versionCode}_Daten_${year}_DE`) {
    throw new Error('Unexpected BLS food worksheet layout');
  }
  const foodsWorksheet = foodsWorkbook.worksheets[0];
  const worksheetXml = resolveWorksheetXml(workbookFiles, foodsWorksheet.name);
  const columnMappings = mapHeaders(foodsWorksheet, components);
  const report = makeEmptyReport(sourceHash, releaseCode, version, bytes.byteLength, archiveEntries);
  report.workbook.foodCount = foodsWorksheet.rowCount - 1;
  report.workbook.componentCount = components.length;
  report.workbook.headerCount = foodsWorksheet.columnCount;
  report.workbook.valueFieldCount = report.workbook.foodCount * components.length;
  report.workbook.completeHeaderMapping = columnMappings.length === components.length;
  let mappedComponentCount = 0;
  for (const component of components) {
    if (CANONICAL_NUTRIENT_CODE_BY_COMPONENT[component.code] !== undefined) mappedComponentCount += 1;
  }
  report.workbook.mappedComponentCount = mappedComponentCount;
  report.workbook.unmappedComponentCount = components.length - mappedComponentCount;
  const duplicateCodes = new Set<string>();
  const foodCodes = new Set<string>();
  for (const food of iterateFoods({
    fileName,
    sourceHash,
    releaseCode,
    version,
    report,
    components,
    columnMappings,
    foodsWorksheet,
    worksheetXml,
    worksheetRowCount: foodsWorksheet.rowCount,
  }, true)) {
    if (foodCodes.has(food.sourceFoodCode)) duplicateCodes.add(food.sourceFoodCode);
    foodCodes.add(food.sourceFoodCode);
    const categoryCode = food.sourceCategoryCode;
    const category = BLS_SOURCE_CATEGORY_BY_SOURCE_CODE[categoryCode];
    const group = category?.code ?? 'unassigned';
    if (report.workbook.foodGroups[group] === undefined) report.workbook.foodGroups[group] = 0;
    report.workbook.foodGroups[group] += 1;
  }
  report.workbook.duplicateFoodCodes = duplicateCodes.size;
  if (report.workbook.foodCount !== foodsWorksheet.rowCount - 1) report.errors.push('Food row count differs from worksheet row count');
  if (duplicateCodes.size > 0) report.errors.push(`${duplicateCodes.size} duplicate BLS food codes`);
  if (report.negativeValueCount > 0) report.errors.push(`${report.negativeValueCount} negative source nutrient values`);
  if (report.unknownMarkerCount > 0) report.errors.push(`${report.unknownMarkerCount} unrecognized source value markers`);
  let categorizedFoodCount = 0;
  for (const count of Object.values(report.workbook.foodGroups)) categorizedFoodCount += count;
  if (categorizedFoodCount !== report.workbook.foodCount) {
    report.errors.push('Some foods could not be assigned to a documented BLS source group');
  }
  if (report.workbook.headerCount !== components.length * 3 + 4) report.errors.push('Not all BLS headers are mapped');
  compareKnownRelease(report);
  report.valid = report.errors.length === 0;

  return {
    fileName,
    sourceHash,
    releaseCode,
    version,
    report,
    components,
    columnMappings,
    foodsWorksheet,
    worksheetXml,
    worksheetRowCount: foodsWorksheet.rowCount,
  };
}
