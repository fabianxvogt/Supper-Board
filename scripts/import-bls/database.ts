import { Client } from 'pg';
import { BLS_MAPPING_VERSION } from '../../src/domain/nutrient-mappings.js';
import { BLS_DISPLAY_PARENT_CODE_BY_SOURCE_CODE, BLS_SOURCE_CATEGORY_BY_SOURCE_CODE, BLS_SOURCE_CATEGORIES, DISPLAY_CATEGORY_HIERARCHY_VERSION, DISPLAY_CATEGORY_ROOTS, SOURCE_CATEGORY_HIERARCHY_VERSION } from './categories.js';
import {
  BLS_ATTRIBUTION,
  BLS_LICENSE,
  BLS_SOURCE_CODE,
  BLS_SOURCE_ID,
  CANONICAL_NUTRIENT_CODE_BY_COMPONENT,
  iterateFoods,
  type BlsImportReport,
  type ParsedBlsRelease,
  type ParsedFood,
  type SourceComponent,
} from './parse.js';

const OFFICIAL_DOWNLOAD_PAGE = 'https://blsdb.prod.se.ble.de/download';
const DATABASE_APPLICATION_NAME = 'supper-board-bls-import';
const FOOD_BATCH_SIZE = 64;

interface ExistingRelease {
  id: string;
  status: string;
  release_code: string;
  source_sha256: string;
}

interface NutrientDefinitionRow {
  id: string;
  code: string;
  unit: string;
  basis: string;
}

interface CategoryRow {
  id: string;
  code: string;
  name_de: string;
  name_en: string | null;
  parent_id: string | null;
  hierarchy_version: string;
}

interface SourceComponentRow {
  component_code: string;
  name_de: string;
  name_en: string | null;
  unit: string | null;
  group_code: string | null;
  formula: string | null;
  usage_description: string | null;
  metadata: { index?: number; groupEn?: string };
}

interface NutrientMappingRow {
  source_component_code: string;
  nutrient_definition_id: string | null;
  mapping_status: string;
  source_unit: string | null;
  transform: { kind?: string; sourceUnit?: string; mappingVersion?: string };
  reviewed_at: Date | string | null;
}

export interface CatalogDryRun {
  sourceId: string;
  sourceCode: string;
  sourceSeedReady: boolean;
  missingCanonicalNutrients: string[];
  missingCategories: string[];
  existingRelease: ExistingRelease | null;
  releaseCodeConflict: ExistingRelease | null;
  activeReleaseId: string | null;
  action: 'import' | 'resume_staging' | 'already_active' | 'already_superseded' | 'blocked';
  expected: {
    foods: number;
    components: number;
    nutrientValues: number;
  };
  report: BlsImportReport;
}

export interface ApplyResult {
  releaseId: string;
  status: 'active' | 'already_active' | 'already_superseded';
  activated: boolean;
  previousActiveReleaseIds: string[];
  report: BlsImportReport;
}

function databaseIsLocal(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname === '[::1]';
}

async function verifyAdminPrivileges(client: Client): Promise<void> {
  const roleResult = await client.query<{ can_bypass_rls: boolean }>(
    `select (r.rolsuper or r.rolbypassrls) as can_bypass_rls
       from pg_catalog.pg_roles r
      where r.rolname = current_user`,
  );
  if (roleResult.rowCount !== 1 || roleResult.rows[0].can_bypass_rls !== true) {
    throw new Error('DATABASE_URL must connect as a PostgreSQL administrator that bypasses RLS');
  }

  const privilegeResult = await client.query<{ can_write: boolean }>(
    `select has_table_privilege(current_user, 'public.food_sources', 'SELECT')
          and has_table_privilege(current_user, 'public.source_releases', 'SELECT,INSERT,UPDATE')
          and has_table_privilege(current_user, 'public.source_components', 'SELECT,INSERT')
          and has_table_privilege(current_user, 'public.nutrient_mappings', 'SELECT,INSERT')
          and has_table_privilege(current_user, 'public.categories', 'SELECT,INSERT')
          and has_table_privilege(current_user, 'public.foods', 'SELECT,INSERT')
          and has_table_privilege(current_user, 'public.food_versions', 'SELECT,INSERT')
          and has_table_privilege(current_user, 'public.food_nutrient_values', 'SELECT,INSERT')
          and has_table_privilege(current_user, 'public.food_categories', 'SELECT,INSERT')
          as can_write`,
  );
  if (privilegeResult.rows[0]?.can_write !== true) {
    throw new Error('DATABASE_URL user is missing required catalog import table privileges');
  }
}

export async function openAdminConnection(): Promise<Client> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('Set DATABASE_URL to an administrative PostgreSQL connection string');

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(connectionString);
  } catch {
    throw new Error('DATABASE_URL is not a valid PostgreSQL connection URL');
  }
  if (parsedUrl.protocol !== 'postgres:' && parsedUrl.protocol !== 'postgresql:') {
    throw new Error('DATABASE_URL must use the postgres or postgresql protocol');
  }
  if (parsedUrl.username.length === 0 || parsedUrl.password.length === 0) {
    throw new Error('DATABASE_URL must include database administrator credentials');
  }

  const localDatabase = databaseIsLocal(parsedUrl.hostname);
  const sslMode = parsedUrl.searchParams.get('sslmode');
  if (!localDatabase && sslMode !== 'verify-full') {
    throw new Error('Remote DATABASE_URL connections require sslmode=verify-full');
  }
  if (sslMode === 'no-verify' || sslMode === 'disable' || sslMode === 'allow' || sslMode === 'prefer') {
    throw new Error('DATABASE_URL cannot disable or bypass TLS certificate verification');
  }
  for (const option of ['sslcert', 'sslkey', 'sslrootcert']) {
    if (parsedUrl.searchParams.has(option)) {
      throw new Error(`DATABASE_URL must not override the importer TLS policy with ${option}`);
    }
  }
  parsedUrl.searchParams.delete('sslmode');

  const client = new Client({
    connectionString: parsedUrl.toString(),
    application_name: DATABASE_APPLICATION_NAME,
    connectionTimeoutMillis: 10000,
    statement_timeout: 120000,
    idle_in_transaction_session_timeout: 0,
    ssl: localDatabase ? false : { rejectUnauthorized: true },
  });
  await client.connect();
  try {
    await verifyAdminPrivileges(client);
  } catch (error) {
    await client.end();
    throw error;
  }
  return client;
}

async function loadSourceId(client: Client): Promise<void> {
  const sourceResult = await client.query<{ id: string; license: string | null; attribution: string | null }>(
    `select id::text, license, attribution
       from public.food_sources
      where code = $1`,
    [BLS_SOURCE_CODE],
  );
  if (sourceResult.rowCount !== 1) {
    throw new Error('BLS food_sources seed is missing; apply the database schema seed before importing');
  }
  const source = sourceResult.rows[0];
  if (source.id !== BLS_SOURCE_ID || source.license !== BLS_LICENSE || source.attribution !== BLS_ATTRIBUTION) {
    throw new Error('BLS food_sources seed identity, license, or attribution does not match the importer contract');
  }
}

function componentCodes(components: SourceComponent[]): string[] {
  const codes: string[] = [];
  for (const component of components) codes.push(component.code);
  return codes;
}

function canonicalCodes(components: SourceComponent[]): string[] {
  const codes = new Set<string>();
  for (const component of components) {
    const canonicalCode = CANONICAL_NUTRIENT_CODE_BY_COMPONENT[component.code];
    if (canonicalCode !== undefined) codes.add(canonicalCode);
  }
  return [...codes];
}

type BlsCategoryDefinition = Omit<CategoryRow, 'id'>;

function categoryCodes(): string[] {
  const codes: string[] = [];
  for (const category of DISPLAY_CATEGORY_ROOTS) codes.push(category.code);
  for (const category of BLS_SOURCE_CATEGORIES) codes.push(category.code);
  return codes;
}

function sourceCategoryDefinitions(displayRootIds: Record<string, string>): BlsCategoryDefinition[] {
  const definitions: BlsCategoryDefinition[] = [];
  for (const sourceCategory of BLS_SOURCE_CATEGORIES) {
    const parentCode = BLS_DISPLAY_PARENT_CODE_BY_SOURCE_CODE[sourceCategory.sourceCode];
    if (sourceCategory.sourceCode !== '?' && !parentCode) {
      throw new Error(`BLS source group ${sourceCategory.sourceCode} has no display category mapping`);
    }
    const parentId = parentCode ? displayRootIds[parentCode] : null;
    if (parentCode && !parentId) throw new Error(`Display category ${parentCode} is not seeded`);
    definitions.push({
      code: sourceCategory.code,
      name_de: sourceCategory.nameDe,
      name_en: sourceCategory.nameEn,
      parent_id: parentId,
      hierarchy_version: SOURCE_CATEGORY_HIERARCHY_VERSION,
    });
  }
  return definitions;
}

async function loadReleaseRows(
  client: Client,
  release: ParsedBlsRelease,
): Promise<{ byHash: ExistingRelease | null; byCode: ExistingRelease | null; activeId: string | null }> {
  const byHashResult = await client.query<ExistingRelease>(
      `select id::text, status, release_code, source_sha256
         from public.source_releases
        where source_id = $1 and source_sha256 = $2`,
      [BLS_SOURCE_ID, release.sourceHash],
    );
  const byCodeResult = await client.query<ExistingRelease>(
      `select id::text, status, release_code, source_sha256
         from public.source_releases
        where source_id = $1 and release_code = $2`,
      [BLS_SOURCE_ID, release.releaseCode],
    );
  const activeResult = await client.query<{ id: string }>(
      `select id::text
         from public.source_releases
        where source_id = $1 and status = 'active'`,
      [BLS_SOURCE_ID],
    );
  if (byHashResult.rows.length > 1 || byCodeResult.rows.length > 1 || activeResult.rows.length > 1) {
    throw new Error('BLS release uniqueness invariant is violated in the database');
  }
  return {
    byHash: byHashResult.rows[0] ?? null,
    byCode: byCodeResult.rows[0] ?? null,
    activeId: activeResult.rows[0]?.id ?? null,
  };
}

async function missingCatalogSeeds(
  client: Client,
  release: ParsedBlsRelease,
): Promise<{ missingCanonicalNutrients: string[]; missingCategories: string[] }> {
  const nutrientCodes = canonicalCodes(release.components);
  const nutrientResult = await client.query<{ code: string }>(
    'select code from public.nutrient_definitions where code = any($1::text[])',
    [nutrientCodes],
  );
  const foundNutrients = new Set<string>();
  for (const row of nutrientResult.rows) foundNutrients.add(row.code);
  const missingCanonicalNutrients: string[] = [];
  for (const code of nutrientCodes) {
    if (!foundNutrients.has(code)) missingCanonicalNutrients.push(code);
  }

  const expectedCategoryCodes = categoryCodes();
  const categoryResult = await client.query<{ code: string }>(
    'select code from public.categories where code = any($1::text[])',
    [expectedCategoryCodes],
  );
  const foundCategories = new Set<string>();
  for (const row of categoryResult.rows) foundCategories.add(row.code);
  const missingCategories: string[] = [];
  for (const code of expectedCategoryCodes) {
    if (!foundCategories.has(code)) missingCategories.push(code);
  }
  return { missingCanonicalNutrients, missingCategories };
}

export async function previewImport(client: Client, release: ParsedBlsRelease): Promise<CatalogDryRun> {
  if (!release.report.valid) throw new Error('Cannot preview an invalid BLS dataset');
  await loadSourceId(client);
  const releaseRows = await loadReleaseRows(client, release);
  const missing = await missingCatalogSeeds(client, release);
  const releaseCodeConflict =
    releaseRows.byCode !== null && releaseRows.byCode.source_sha256 !== release.sourceHash ? releaseRows.byCode : null;
  let action: CatalogDryRun['action'] = 'import';
  if (releaseRows.byHash?.status === 'active') action = 'already_active';
  else if (releaseRows.byHash?.status === 'superseded') action = 'already_superseded';
  else if (releaseCodeConflict !== null) action = 'blocked';
  else if (missing.missingCanonicalNutrients.length > 0 || missing.missingCategories.length > 0) action = 'blocked';
  else if (releaseRows.byHash?.status === 'staging') action = 'resume_staging';
  else if (releaseRows.byHash !== null) action = 'blocked';

  return {
    sourceId: BLS_SOURCE_ID,
    sourceCode: BLS_SOURCE_CODE,
    sourceSeedReady: true,
    missingCanonicalNutrients: missing.missingCanonicalNutrients,
    missingCategories: missing.missingCategories,
    existingRelease: releaseRows.byHash,
    releaseCodeConflict,
    activeReleaseId: releaseRows.activeId,
    action,
    expected: {
      foods: release.report.workbook.foodCount,
      components: release.report.workbook.componentCount,
      nutrientValues: release.report.workbook.valueFieldCount,
    },
    report: release.report,
  };
}

async function validateCategoryRows(client: Client): Promise<Record<string, string>> {
  const categoryIds: Record<string, string> = Object.create(null);
  const rootCodes: string[] = [];

  for (const root of DISPLAY_CATEGORY_ROOTS) {
    rootCodes.push(root.code);
    await client.query(
      `insert into public.categories (code,name_de,name_en,parent_id,hierarchy_version)
       values ($1,$2,$3,null,$4)
       on conflict (code) do nothing`,
      [root.code, root.nameDe, root.nameEn, DISPLAY_CATEGORY_HIERARCHY_VERSION],
    );
  }

  const rootResult = await client.query<CategoryRow>(
    `select id::text, code, name_de, name_en, parent_id::text, hierarchy_version
       from public.categories
      where code = any($1::text[])`,
    [rootCodes],
  );
  const rootsByCode: Record<string, CategoryRow> = Object.create(null);
  for (const row of rootResult.rows) rootsByCode[row.code] = row;
  for (const root of DISPLAY_CATEGORY_ROOTS) {
    const existing = rootsByCode[root.code];
    if (
      !existing ||
      existing.name_de !== root.nameDe ||
      existing.name_en !== root.nameEn ||
      existing.parent_id !== null ||
      existing.hierarchy_version !== DISPLAY_CATEGORY_HIERARCHY_VERSION
    ) {
      throw new Error(`Display category ${root.code} conflicts with the versioned hierarchy`);
    }
    categoryIds[root.code] = existing.id;
  }

  const definitions = sourceCategoryDefinitions(categoryIds);
  const codes: string[] = [];
  for (const category of definitions) codes.push(category.code);
  for (const category of definitions) {
    await client.query(
      `insert into public.categories (code,name_de,name_en,parent_id,hierarchy_version)
       values ($1,$2,$3,$4,$5)
       on conflict (code) do nothing`,
      [category.code, category.name_de, category.name_en, category.parent_id, category.hierarchy_version],
    );
  }

  const confirmedResult = await client.query<CategoryRow>(
    `select id::text, code, name_de, name_en, parent_id::text, hierarchy_version
       from public.categories
      where code = any($1::text[])`,
    [codes],
  );
  const confirmedByCode: Record<string, CategoryRow> = Object.create(null);
  for (const row of confirmedResult.rows) confirmedByCode[row.code] = row;
  for (const definition of definitions) {
    const existing = confirmedByCode[definition.code];
    if (
      !existing ||
      existing.name_de !== definition.name_de ||
      existing.name_en !== definition.name_en ||
      existing.parent_id !== definition.parent_id ||
      existing.hierarchy_version !== definition.hierarchy_version
    ) {
      throw new Error(`BLS category ${definition.code} conflicts with the versioned source category crosswalk`);
    }
    categoryIds[definition.code] = existing.id;
  }
  return categoryIds;
}

function componentMetadata(component: SourceComponent): Record<string, unknown> {
  return { index: component.index, groupEn: component.groupEn };
}

async function validateSourceComponents(client: Client, components: SourceComponent[]): Promise<void> {
  const payload: Array<Record<string, unknown>> = [];
  for (const component of components) {
    payload.push({
      source_id: BLS_SOURCE_ID,
      component_code: component.code,
      name_de: component.nameDe,
      name_en: component.nameEn,
      unit: component.unit,
      group_code: component.groupDe,
      formula: component.formula,
      usage_description: component.formulaApplication,
      metadata: componentMetadata(component),
    });
  }
  await client.query(
    `insert into public.source_components
       (source_id,component_code,name_de,name_en,unit,group_code,formula,usage_description,metadata)
     select x.source_id::uuid,x.component_code,x.name_de,x.name_en,x.unit,x.group_code,x.formula,x.usage_description,x.metadata
       from jsonb_to_recordset($1::jsonb) as x(
         source_id text,component_code text,name_de text,name_en text,unit text,group_code text,
         formula text,usage_description text,metadata jsonb)
     on conflict (source_id,component_code) do nothing`,
    [JSON.stringify(payload)],
  );

  const existingResult = await client.query<SourceComponentRow>(
    `select component_code,name_de,name_en,unit,group_code,formula,usage_description,metadata
       from public.source_components
      where source_id = $1 and component_code = any($2::text[])`,
    [BLS_SOURCE_ID, componentCodes(components)],
  );
  const existingByCode: Record<string, SourceComponentRow> = {};
  for (const row of existingResult.rows) existingByCode[row.component_code] = row;
  for (const component of components) {
    const row = existingByCode[component.code];
    const metadata = componentMetadata(component);
    if (
      !row ||
      row.name_de !== component.nameDe ||
      row.name_en !== component.nameEn ||
      row.unit !== component.unit ||
      row.group_code !== component.groupDe ||
      row.formula !== component.formula ||
      row.usage_description !== component.formulaApplication ||
      row.metadata.index !== metadata.index ||
      row.metadata.groupEn !== metadata.groupEn
    ) {
      throw new Error(`BLS source component ${component.code} differs from the stored source definition`);
    }
  }
}

async function validateNutrientDefinitions(
  client: Client,
  components: SourceComponent[],
): Promise<Record<string, NutrientDefinitionRow>> {
  const codes = canonicalCodes(components);
  const result = await client.query<NutrientDefinitionRow>(
    `select id::text,code,unit,basis
       from public.nutrient_definitions
      where code = any($1::text[])`,
    [codes],
  );
  const definitions: Record<string, NutrientDefinitionRow> = {};
  for (const row of result.rows) definitions[row.code] = row;
  for (const component of components) {
    const canonicalCode = CANONICAL_NUTRIENT_CODE_BY_COMPONENT[component.code];
    if (canonicalCode === undefined) continue;
    const definition = definitions[canonicalCode];
    if (!definition) throw new Error(`Canonical nutrient definition ${canonicalCode} is missing`);
    if (definition.unit !== component.unit) {
      throw new Error(`Unit mismatch between BLS ${component.code} (${component.unit}) and ${canonicalCode} (${definition.unit})`);
    }
    if (definition.basis !== 'edible') {
      throw new Error(`Basis mismatch between BLS ${component.code} and ${canonicalCode}: expected edible`);
    }
  }
  return definitions;
}

async function validateMappings(
  client: Client,
  components: SourceComponent[],
  nutrientDefinitions: Record<string, NutrientDefinitionRow>,
): Promise<Record<string, string | null>> {
  const payload: Array<Record<string, unknown>> = [];
  for (const component of components) {
    const canonicalCode = CANONICAL_NUTRIENT_CODE_BY_COMPONENT[component.code];
    const definitionId = canonicalCode === undefined ? null : nutrientDefinitions[canonicalCode].id;
    const mappingStatus = canonicalCode === undefined ? 'unmapped' : 'reviewed';
    payload.push({
      source_id: BLS_SOURCE_ID,
      source_component_code: component.code,
      nutrient_definition_id: definitionId,
      mapping_version: BLS_MAPPING_VERSION,
      mapping_status: mappingStatus,
      source_unit: component.unit,
      transform: {
        kind: 'identity',
        sourceUnit: component.unit,
        mappingVersion: BLS_MAPPING_VERSION,
      },
    });
  }
  await client.query(
    `insert into public.nutrient_mappings
       (source_id,source_component_code,nutrient_definition_id,mapping_version,mapping_status,source_unit,transform,reviewed_by,reviewed_at)
     select x.source_id::uuid,x.source_component_code,x.nutrient_definition_id::uuid,
            x.mapping_version,x.mapping_status,x.source_unit,x.transform,
            case when x.mapping_status='reviewed' then 'BLS 4.0 semantic crosswalk v1' else null end,
            case when x.mapping_status='reviewed' then now() else null end
       from jsonb_to_recordset($1::jsonb) as x(
         source_id text,source_component_code text,nutrient_definition_id text,mapping_version text,
         mapping_status text,source_unit text,transform jsonb)
     on conflict (source_id,source_component_code,mapping_version) do nothing`,
    [JSON.stringify(payload)],
  );

  const existingResult = await client.query<NutrientMappingRow>(
    `select source_component_code,nutrient_definition_id::text,mapping_status,source_unit,transform,reviewed_at
       from public.nutrient_mappings
      where source_id = $1 and mapping_version = $2 and source_component_code = any($3::text[])`,
    [BLS_SOURCE_ID, BLS_MAPPING_VERSION, componentCodes(components)],
  );
  const existingByCode: Record<string, NutrientMappingRow> = {};
  for (const row of existingResult.rows) existingByCode[row.source_component_code] = row;
  const definitionIdByComponent: Record<string, string | null> = {};
  for (const component of components) {
    const canonicalCode = CANONICAL_NUTRIENT_CODE_BY_COMPONENT[component.code];
    const expectedId = canonicalCode === undefined ? null : nutrientDefinitions[canonicalCode].id;
    const expectedStatus = canonicalCode === undefined ? 'unmapped' : 'reviewed';
    const row = existingByCode[component.code];
    if (
      !row ||
      row.nutrient_definition_id !== expectedId ||
      row.mapping_status !== expectedStatus ||
      row.source_unit !== component.unit ||
      row.transform.kind !== 'identity' ||
      row.transform.sourceUnit !== component.unit ||
      row.transform.mappingVersion !== BLS_MAPPING_VERSION ||
      (expectedStatus === 'reviewed' && row.reviewed_at === null)
    ) {
      throw new Error(`BLS nutrient mapping ${component.code}/${BLS_MAPPING_VERSION} conflicts with the reviewed crosswalk`);
    }
    definitionIdByComponent[component.code] = expectedId;
  }
  return definitionIdByComponent;
}

async function insertFoodBatch(
  client: Client,
  releaseId: string,
  foods: ParsedFood[],
  categoryIds: Record<string, string>,
  componentsByCode: Record<string, SourceComponent>,
  definitionIdByComponent: Record<string, string | null>,
): Promise<void> {
  const foodCodes: string[] = [];
  const identityRows: Array<{ source_food_code: string }> = [];
  for (const food of foods) {
    foodCodes.push(food.sourceFoodCode);
    identityRows.push({ source_food_code: food.sourceFoodCode });
  }
  await client.query(
    `insert into public.foods (source_id,source_food_code)
     select $1::uuid,x.source_food_code
       from jsonb_to_recordset($2::jsonb) as x(source_food_code text)
     on conflict (source_id,source_food_code) where source_id is not null do nothing`,
    [BLS_SOURCE_ID, JSON.stringify(identityRows)],
  );

  const foodResult = await client.query<{ id: string; source_food_code: string }>(
    `select id::text,source_food_code
       from public.foods
      where source_id = $1 and source_food_code = any($2::text[])`,
    [BLS_SOURCE_ID, foodCodes],
  );
  const foodIdByCode: Record<string, string> = {};
  for (const row of foodResult.rows) foodIdByCode[row.source_food_code] = row.id;
  if (foodResult.rowCount !== foods.length) throw new Error('Some BLS food identities could not be resolved');

  const foodIds: string[] = [];
  for (const food of foods) foodIds.push(foodIdByCode[food.sourceFoodCode]);
  const versionResult = await client.query<{ food_id: string; latest_version: number }>(
    `select food_id::text,max(version_number)::integer as latest_version
       from public.food_versions
      where food_id = any($1::uuid[])
      group by food_id`,
    [foodIds],
  );
  const latestVersionByFoodId: Record<string, number> = {};
  for (const row of versionResult.rows) latestVersionByFoodId[row.food_id] = row.latest_version;
  const versionRows: Array<Record<string, unknown>> = [];
  for (const food of foods) {
    const foodId = foodIdByCode[food.sourceFoodCode];
    const previousVersion = latestVersionByFoodId[foodId] ?? 0;
    versionRows.push({
      food_id: foodId,
      version_number: previousVersion + 1,
      name_de: food.nameDe,
      name_en: food.nameEn,
      preparation_state: null,
      source_notes: food.sourceNotes,
      nutrient_basis: 'edible',
    });
  }
  await client.query(
    `insert into public.food_versions
       (food_id,source_release_id,version_number,name_de,name_en,preparation_state,source_notes,nutrient_basis)
     select x.food_id::uuid,$1::uuid,x.version_number,x.name_de,x.name_en,x.preparation_state,x.source_notes,x.nutrient_basis
       from jsonb_to_recordset($2::jsonb) as x(
         food_id text,version_number integer,name_de text,name_en text,preparation_state text,source_notes text,nutrient_basis text)`,
    [releaseId, JSON.stringify(versionRows)],
  );

  const foodVersionResult = await client.query<{ id: string; food_id: string }>(
    `select id::text,food_id::text
       from public.food_versions
      where source_release_id = $1 and food_id = any($2::uuid[])`,
    [releaseId, foodIds],
  );
  const foodVersionIdByFoodId: Record<string, string> = {};
  for (const row of foodVersionResult.rows) foodVersionIdByFoodId[row.food_id] = row.id;
  if (foodVersionResult.rowCount !== foods.length) throw new Error('Some immutable BLS food versions could not be resolved');

  const nutrientRows: Array<Record<string, unknown>> = [];
  const categoryRows: Array<{ food_version_id: string; category_id: string; source_category_code: string }> = [];
  for (const food of foods) {
    const foodId = foodIdByCode[food.sourceFoodCode];
    const foodVersionId = foodVersionIdByFoodId[foodId];
    const sourceCategory = BLS_SOURCE_CATEGORY_BY_SOURCE_CODE[food.sourceCategoryCode];
    const category = sourceCategory ?? BLS_SOURCE_CATEGORY_BY_SOURCE_CODE['?'];
    const categoryId = categoryIds[category.code];
    if (!categoryId) throw new Error(`BLS category ${category.code} is not seeded`);
    categoryRows.push({
      food_version_id: foodVersionId,
      category_id: categoryId,
      source_category_code: food.sourceCategoryCode,
    });

    for (const nutrient of food.nutrients) {
      const component = componentsByCode[nutrient.componentCode];
      nutrientRows.push({
        food_version_id: foodVersionId,
        source_component_code: nutrient.componentCode,
        nutrient_definition_id: definitionIdByComponent[nutrient.componentCode],
        raw_value: nutrient.rawValue,
        normalized_amount: nutrient.normalizedAmount,
        unit: component.unit,
        value_status: nutrient.valueStatus,
        source_method: nutrient.sourceMethod,
        source_reference: nutrient.sourceReference,
        mapping_version: BLS_MAPPING_VERSION,
      });
    }
  }
  await client.query(
    `insert into public.food_nutrient_values
       (food_version_id,source_component_code,nutrient_definition_id,raw_value,normalized_amount,unit,value_status,source_method,source_reference,mapping_version)
     select x.food_version_id::uuid,x.source_component_code,x.nutrient_definition_id::uuid,
            x.raw_value,x.normalized_amount::numeric,x.unit,x.value_status,x.source_method,x.source_reference,x.mapping_version
       from jsonb_to_recordset($1::jsonb) as x(
         food_version_id text,source_component_code text,nutrient_definition_id text,raw_value text,
         normalized_amount text,unit text,value_status text,source_method text,source_reference text,mapping_version text)`,
    [JSON.stringify(nutrientRows)],
  );
  await client.query(
    `insert into public.food_categories (food_version_id,category_id,is_primary,source_category_code)
     select x.food_version_id::uuid,x.category_id::uuid,true,x.source_category_code
       from jsonb_to_recordset($1::jsonb) as x(food_version_id text,category_id text,source_category_code text)`,
    [JSON.stringify(categoryRows)],
  );
}

async function verifyReleaseRows(client: Client, releaseId: string, report: BlsImportReport): Promise<void> {
  const result = await client.query<{ foods: string; nutrient_values: string; categories: string; non_edible_basis: string }>(
    `select count(distinct v.food_id)::text as foods,
            (select count(*)::text from public.food_nutrient_values n
               join public.food_versions nv on nv.id=n.food_version_id
              where nv.source_release_id=$1) as nutrient_values,
            (select count(*)::text from public.food_categories c
               join public.food_versions cv on cv.id=c.food_version_id
              where cv.source_release_id=$1) as categories,
            count(*) filter (where v.nutrient_basis is distinct from 'edible')::text as non_edible_basis
       from public.food_versions v
      where v.source_release_id=$1`,
    [releaseId],
  );
  const row = result.rows[0];
  if (
    Number(row.foods) !== report.workbook.foodCount ||
    Number(row.nutrient_values) !== report.workbook.valueFieldCount ||
    Number(row.categories) !== report.workbook.foodCount ||
    Number(row.non_edible_basis) !== 0
  ) {
    throw new Error(
      `Staged BLS rows do not match the validated report (foods=${row.foods}, values=${row.nutrient_values}, categories=${row.categories}, nonEdibleBasis=${row.non_edible_basis})`,
    );
  }
}

async function withTransaction<T>(client: Client, operation: () => Promise<T>): Promise<T> {
  await client.query('begin');
  try {
    const result = await operation();
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback');
    throw error;
  }
}

async function createOrLoadStagingRelease(client: Client, release: ParsedBlsRelease): Promise<ExistingRelease> {
  await client.query('begin');
  try {
    await client.query('select id from public.food_sources where id=$1 for update', [BLS_SOURCE_ID]);
    const existing = await loadReleaseRows(client, release);
    if (existing.byHash !== null) {
      await client.query('commit');
      return existing.byHash;
    }
    if (existing.byCode !== null) {
      throw new Error(`Release code ${release.releaseCode} already exists with another source hash`);
    }
    const inserted = await client.query<ExistingRelease>(
      `insert into public.source_releases (source_id,release_code,source_sha256,source_url,status,import_report)
       values ($1,$2,$3,$4,'staging',$5::jsonb)
       returning id::text,status,release_code,source_sha256`,
      [BLS_SOURCE_ID, release.releaseCode, release.sourceHash, OFFICIAL_DOWNLOAD_PAGE, JSON.stringify(release.report)],
    );
    await client.query('commit');
    return inserted.rows[0];
  } catch (error) {
    await client.query('rollback');
    throw error;
  }
}

export async function applyRelease(client: Client, release: ParsedBlsRelease): Promise<ApplyResult> {
  if (!release.report.valid) throw new Error('Cannot apply an invalid BLS dataset');
  await loadSourceId(client);
  const releaseRow = await createOrLoadStagingRelease(client, release);
  if (releaseRow.status === 'active') {
    return {
      releaseId: releaseRow.id,
      status: 'already_active',
      activated: false,
      previousActiveReleaseIds: [],
      report: release.report,
    };
  }
  if (releaseRow.status === 'superseded') {
    return {
      releaseId: releaseRow.id,
      status: 'already_superseded',
      activated: false,
      previousActiveReleaseIds: [],
      report: release.report,
    };
  }
  if (releaseRow.status !== 'staging') {
    throw new Error(`Release ${releaseRow.release_code} has status ${releaseRow.status}; only a staging release can be resumed`);
  }

  const outcome = await withTransaction(client, async () => {
    await client.query('select id from public.food_sources where id=$1 for update', [BLS_SOURCE_ID]);
    const targetResult = await client.query<{ id: string; status: string }>(
      `select id::text,status from public.source_releases where id=$1 and source_id=$2 for update`,
      [releaseRow.id, BLS_SOURCE_ID],
    );
    if (targetResult.rowCount !== 1) throw new Error('BLS release disappeared before the import transaction began');
    if (targetResult.rows[0].status === 'active') {
      return { status: 'already_active' as const, previousActiveReleaseIds: [] };
    }
    if (targetResult.rows[0].status === 'superseded') {
      return { status: 'already_superseded' as const, previousActiveReleaseIds: [] };
    }
    if (targetResult.rows[0].status !== 'staging') {
      throw new Error(`BLS release has status ${targetResult.rows[0].status}; only staging can be resumed`);
    }

    const categoryIds = await validateCategoryRows(client);
    await validateSourceComponents(client, release.components);
    const nutrientDefinitions = await validateNutrientDefinitions(client, release.components);
    const definitionIdByComponent = await validateMappings(client, release.components, nutrientDefinitions);
    const componentsByCode: Record<string, SourceComponent> = {};
    for (const component of release.components) componentsByCode[component.code] = component;

    let batch: ParsedFood[] = [];
    for (const food of iterateFoods(release)) {
      batch.push(food);
      if (batch.length === FOOD_BATCH_SIZE) {
        await insertFoodBatch(client, releaseRow.id, batch, categoryIds, componentsByCode, definitionIdByComponent);
        batch = [];
      }
    }
    if (batch.length > 0) {
      await insertFoodBatch(client, releaseRow.id, batch, categoryIds, componentsByCode, definitionIdByComponent);
    }
    await verifyReleaseRows(client, releaseRow.id, release.report);

    const activeRows = await client.query<{ id: string }>(
      `select id::text from public.source_releases where source_id=$1 and status='active' for update`,
      [BLS_SOURCE_ID],
    );
    const previousActiveReleaseIds: string[] = [];
    for (const row of activeRows.rows) {
      if (row.id !== releaseRow.id) previousActiveReleaseIds.push(row.id);
    }
    await client.query(
      `update public.source_releases
          set status='superseded'
        where source_id=$1 and status='active' and id<>$2`,
      [BLS_SOURCE_ID, releaseRow.id],
    );
    await client.query(
      `update public.source_releases
          set status='validated',import_report=$2::jsonb
        where id=$1`,
      [releaseRow.id, JSON.stringify(release.report)],
    );
    await client.query(
      `update public.source_releases
          set status='active'
        where id=$1 and status='validated'`,
      [releaseRow.id],
    );
    return { status: 'active' as const, previousActiveReleaseIds };
  });

  return {
    releaseId: releaseRow.id,
    status: outcome.status,
    activated: outcome.status === 'active',
    previousActiveReleaseIds: outcome.previousActiveReleaseIds,
    report: release.report,
  };
}
