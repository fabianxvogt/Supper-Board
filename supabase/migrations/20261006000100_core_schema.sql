-- Supper Board Nutrition local-first schema. User writes go through revisioned RPCs.
create extension if not exists pgcrypto with schema extensions;
create extension if not exists pg_trgm with schema extensions;

create or replace function public.numeric_is_finite(value numeric)
returns boolean language sql immutable strict set search_path = ''
as $$ select value::text not in ('NaN', 'Infinity', '-Infinity') $$;

create or replace function public.touch_updated_at()
returns trigger language plpgsql set search_path = ''
as $$ begin new.updated_at := now(); return new; end $$;

create table public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 120),
  locale text not null default 'de-DE',
  country_code text not null default 'DE' check (country_code ~ '^[A-Z]{2}$'),
  currency text not null default 'EUR' check (currency ~ '^[A-Z]{3}$'),
  time_zone text not null default 'Europe/Berlin',
  revision integer not null default 1 check (revision > 0),
  plan_revision integer not null default 0 check (plan_revision >= 0),
  inventory_revision integer not null default 0 check (inventory_revision >= 0),
  shopping_revision integer not null default 0 check (shopping_revision >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger households_touch before update on public.households for each row execute function public.touch_updated_at();

create table public.household_members (
  household_id uuid not null references public.households(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner','editor','viewer')),
  added_at timestamptz not null default now(),
  primary key (household_id,user_id)
);
create index household_members_user_idx on public.household_members(user_id,household_id);

create table public.household_invitations (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  invited_email text null check (invited_email is null or (invited_email=lower(invited_email) and invited_email ~ '^[^@[:space:]]+@[^@[:space:]]+$')),
  role text not null check (role in ('editor','viewer')),
  token_hash text not null unique,
  invited_by uuid not null references auth.users(id) on delete restrict,
  expires_at timestamptz not null,
  accepted_at timestamptz null,
  accepted_by uuid null references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (household_id,id)
);
create index household_invitations_open_idx on public.household_invitations(household_id,expires_at) where accepted_at is null;

create table public.legacy_external_ids (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  source_system text not null,
  entity_type text not null check (entity_type in ('person','recipe','recipe_version','ingredient','plan','batch','meal_entry','inventory_item','feedback','shopping_extra')),
  external_id text not null,
  internal_id uuid not null,
  imported_at timestamptz not null default now(),
  unique (household_id,source_system,entity_type,external_id)
);
create index legacy_external_ids_internal_idx on public.legacy_external_ids(household_id,entity_type,internal_id);
create table public.legacy_import_issues (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  source_system text not null,
  entity_type text not null,
  external_id text null,
  issue_code text not null,
  original_value text null,
  details jsonb not null default '{}'::jsonb,
  resolved_at timestamptz null,
  created_at timestamptz not null default now()
);
create index legacy_import_issues_open_idx on public.legacy_import_issues(household_id,created_at) where resolved_at is null;
create table public.data_import_previews (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  token_hash text not null unique,
  input_hash text not null,
  input_payload jsonb not null,
  report jsonb not null,
  expires_at timestamptz not null,
  consumed_at timestamptz null,
  created_at timestamptz not null default now()
);

create table public.persons (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  display_name text not null check (length(btrim(display_name)) between 1 and 100),
  nutrition_mode text not null default 'view' check (nutrition_mode in ('view','manual','guided')),
  linked_user_id uuid null references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (household_id,id),
  unique (household_id,linked_user_id)
);
create index persons_household_idx on public.persons(household_id);

create table public.private_profiles (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null,
  person_id uuid not null,
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  birth_date date null,
  age_years smallint null check (age_years between 0 and 130),
  age_as_of_date date null,
  height_cm numeric null check (height_cm is null or (public.numeric_is_finite(height_cm) and height_cm > 0)),
  weight_kg numeric null check (weight_kg is null or (public.numeric_is_finite(weight_kg) and weight_kg > 0)),
  weight_measured_on date null,
  activity_description text null,
  source_calculation_group text null check (source_calculation_group in ('male','female')),
  reference_context text not null default 'standard_adult' check (reference_context in ('standard_adult','child','older_adult','pregnancy','lactation','clinical','performance','other')),
  pal numeric null check (pal is null or (public.numeric_is_finite(pal) and pal > 0)),
  preferences jsonb not null default '[]'::jsonb check (jsonb_typeof(preferences) = 'array'),
  exclusions jsonb not null default '[]'::jsonb check (jsonb_typeof(exclusions) = 'array'),
  share_targets_with_household boolean not null default false,
  imported_unverified boolean not null default false,
  revision integer not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (household_id,id),
  unique (person_id),
  foreign key (household_id,person_id) references public.persons(household_id,id) on delete restrict,
  check ((age_years is null) = (age_as_of_date is null)),
  constraint private_profiles_age_source_check check (birth_date is null or age_years is null),
  check ((weight_kg is null) = (weight_measured_on is null))
);
create index private_profiles_owner_idx on public.private_profiles(owner_user_id,person_id);
create trigger private_profiles_touch before update on public.private_profiles for each row execute function public.touch_updated_at();

create table public.profile_measurements (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.private_profiles(id) on delete cascade,
  measurement_type text not null check (measurement_type in ('weight','height')),
  value numeric not null check (public.numeric_is_finite(value) and value > 0),
  unit text not null check (unit in ('kg','cm')),
  measured_on date not null,
  created_at timestamptz not null default now(),
  check ((measurement_type='weight' and unit='kg') or (measurement_type='height' and unit='cm')),
  unique (profile_id,measurement_type,measured_on)
);

create table public.energy_estimates (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.private_profiles(id) on delete cascade,
  model_version text not null,
  calculation_date date not null,
  imported_unverified boolean not null default false,
  input_snapshot jsonb not null check (jsonb_typeof(input_snapshot)='object'),
  ree_kcal_per_day numeric null check (ree_kcal_per_day is null or (public.numeric_is_finite(ree_kcal_per_day) and ree_kcal_per_day > 0)),
  maintenance_kcal_per_day numeric null check (maintenance_kcal_per_day is null or (public.numeric_is_finite(maintenance_kcal_per_day) and maintenance_kcal_per_day > 0)),
  created_at timestamptz not null default now()
);

create table public.reference_packs (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  version text not null,
  source_title text not null,
  source_url text not null,
  license text,
  review_status text not null default 'unreviewed' check (review_status in ('unreviewed','reviewed','approved','disabled')),
  reviewed_at timestamptz,
  review_note text,
  created_at timestamptz not null default now(),
  unique (code,version)
);
create table public.reference_values (
  id uuid primary key default gen_random_uuid(),
  reference_pack_id uuid not null references public.reference_packs(id) on delete restrict,
  nutrient_code text not null,
  cohort text not null,
  age_min_years numeric null check (age_min_years is null or (public.numeric_is_finite(age_min_years) and age_min_years >= 0)),
  age_max_years numeric null check (age_max_years is null or (public.numeric_is_finite(age_max_years) and age_max_years >= 0)),
  value numeric not null check (public.numeric_is_finite(value) and value >= 0),
  unit text not null,
  reference_kind text not null check (reference_kind in ('point','range','per_kg','energy_percent','safe_and_adequate')),
  target_unit text null,
  minimum numeric null,
  maximum numeric null,
  reference_type text not null check (reference_type in ('PRI','AI','RI','AR','UL','safe_adequate','other')),
  conditions text,
  source_document text not null,
  source_locator text not null,
  immutable_key text not null,
  created_at timestamptz not null default now(),
  unique (reference_pack_id,immutable_key),
  unique (reference_pack_id,id),
  check (age_min_years is null or age_max_years is null or age_min_years <= age_max_years),
  check ((minimum is null)=(maximum is null)),
  check (minimum is null or (public.numeric_is_finite(minimum) and minimum >= 0 and minimum <= maximum and value=minimum)),
  check ((reference_kind in ('range','energy_percent'))=(minimum is not null)),
  check ((reference_kind='per_kg')=(target_unit is not null)),
  check ((reference_kind='safe_and_adequate')=(reference_type='safe_adequate')),
  check (reference_kind<>'energy_percent' or unit='energy_percent')
);

create table public.target_versions (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null,
  profile_id uuid not null references public.private_profiles(id) on delete cascade,
  version_number integer not null check (version_number > 0),
  valid_from date not null,
  origin text not null check (origin in ('manual','adopted_reference','professional_entered')),
  imported_unverified boolean not null default false,
  reference_pack_id uuid null references public.reference_packs(id) on delete restrict,
  note text,
  created_at timestamptz not null default now(),
  unique (profile_id,version_number),
  unique (household_id,id),
  unique (id,profile_id),
  foreign key (household_id,profile_id) references public.private_profiles(household_id,id) on delete cascade
);
create table public.target_items (
  id uuid primary key default gen_random_uuid(),
  target_version_id uuid not null references public.target_versions(id) on delete cascade,
  nutrient_code text not null,
  unit text not null,
  origin text not null default 'manual' check (origin in ('manual','adopted_reference','professional_entered')),
  target_kind text not null check (target_kind in ('point','range','minimum','maximum')),
  minimum numeric null check (minimum is null or (public.numeric_is_finite(minimum) and minimum >= 0)),
  maximum numeric null check (maximum is null or (public.numeric_is_finite(maximum) and maximum >= 0)),
  point_value numeric null check (point_value is null or (public.numeric_is_finite(point_value) and point_value >= 0)),
  reference_pack_id uuid null,
  reference_value_id uuid null references public.reference_values(id) on delete restrict,
  manually_locked boolean not null default false,
  created_at timestamptz not null default now(),
  unique (target_version_id,nutrient_code),
  unique (id,target_version_id),
  check (minimum is null or maximum is null or minimum <= maximum),
  check ((target_kind='point' and point_value is not null) or (target_kind='range' and minimum is not null and maximum is not null) or (target_kind='minimum' and minimum is not null) or (target_kind='maximum' and maximum is not null)),
  check ((reference_pack_id is null)=(reference_value_id is null)),
  check (origin<>'adopted_reference' or (reference_pack_id is not null and reference_value_id is not null)),
  foreign key (reference_pack_id,reference_value_id) references public.reference_values(reference_pack_id,id) on delete restrict
);
create table public.target_item_private_inputs (
  target_item_id uuid not null,
  target_version_id uuid not null,
  profile_id uuid not null,
  inputs jsonb not null check (jsonb_typeof(inputs)='object' and octet_length(inputs::text)<=4096),
  created_at timestamptz not null default now(),
  primary key (target_item_id),
  foreign key (target_item_id,target_version_id) references public.target_items(id,target_version_id) on delete cascade,
  foreign key (target_version_id,profile_id) references public.target_versions(id,profile_id) on delete cascade
);

create table public.food_sources (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  license text,
  attribution text,
  source_url text,
  created_at timestamptz not null default now()
);
insert into public.food_sources(id,code,name,license,attribution,source_url)
values(
  '00000000-0000-4000-8000-000000000001',
  'bls_4_0',
  'Bundeslebensmittelschlüssel (BLS) 4.0',
  'CC BY 4.0',
  'Bundeslebensmittelschlüssel (BLS) 4.0, Max Rubner-Institut; source: https://doi.org/10.25826/Data20251217-134202-0',
  'https://doi.org/10.25826/Data20251217-134202-0'
);
create table public.source_releases (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.food_sources(id) on delete restrict,
  release_code text not null,
  source_sha256 text not null check (source_sha256 ~ '^[0-9a-f]{64}$'),
  source_url text,
  imported_at timestamptz not null default now(),
  published_at date,
  status text not null default 'staging' check (status in ('staging','validated','active','superseded','rejected')),
  import_report jsonb not null default '{}'::jsonb check (jsonb_typeof(import_report)='object'),
  created_by uuid null references auth.users(id) on delete set null,
  unique (source_id,source_sha256),
  unique (source_id,release_code),
  unique (source_id,id)
);
create unique index one_active_release_per_source on public.source_releases(source_id) where status='active';
create index source_releases_status_idx on public.source_releases(source_id,status,imported_at desc);

create table public.nutrient_definitions (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name_de text not null,
  name_en text,
  unit text not null,
  nutrient_group text not null,
  basis text not null default 'per_100g',
  chemical_form text,
  created_at timestamptz not null default now()
);
insert into public.nutrient_definitions(code,name_de,name_en,unit,nutrient_group,basis,chemical_form) values
  ('energy_kcal','Energie (kcal)','Energy (kcal)','kcal','energy','edible',null),
  ('energy_kj','Energie (kJ)','Energy (kJ)','kJ','energy','edible',null),
  ('protein','Protein','Protein','g','protein','edible',null),
  ('fat','Fett','Total fat','g','lipid','edible',null),
  ('dietary_fiber','Ballaststoffe','Total dietary fibre','g','carbohydrate','edible',null),
  ('vitamin_d','Vitamin D','Vitamin D','µg','vitamin','edible','D2+D3'),
  ('vitamin_e_alpha_tocopherol','Vitamin E (α-Tocopherol)','Vitamin E (alpha-tocopherol)','mg','vitamin','edible','alpha-tocopherol'),
  ('vitamin_b12','Vitamin B12','Vitamin B12','µg','vitamin','edible','cobalamins'),
  ('vitamin_c','Vitamin C','Vitamin C','mg','vitamin','edible',null),
  ('calcium','Calcium','Calcium','mg','mineral','edible',null),
  ('magnesium','Magnesium','Magnesium','mg','mineral','edible',null),
  ('available_carbohydrate','Verfügbare Kohlenhydrate','Available carbohydrate','g','carbohydrate','edible',null),
  ('vitamin_a_re','Vitamin A (RE)','Vitamin A (retinol equivalents)','µg','vitamin','edible','retinol-equivalents'),
  ('vitamin_a_rae','Vitamin A (RAE)','Vitamin A (retinol activity equivalents)','µg','vitamin','edible','retinol-activity-equivalents'),
  ('folate_blsequiv','Folatäquivalent (BLS)','BLS folate equivalent','µg','vitamin','edible','BLS-equivalent'),
  ('dietary_folate','Nahrungsfolat','Dietary folate','µg','vitamin','edible','folate'),
  ('folic_acid','Folsäure','Folic acid','µg','vitamin','edible','folic-acid'),
  ('niacin','Niacin','Niacin','mg','vitamin','edible','niacin'),
  ('niacin_equivalent','Niacinäquivalent','Niacin equivalents','mg','vitamin','edible','niacin-equivalents'),
  ('sodium','Natrium','Sodium','mg','mineral','edible',null),
  ('salt_equivalent','Salzäquivalent','Salt equivalent','g','mineral','edible',null),
  ('vitamin_k1','Vitamin K1','Vitamin K1','µg','vitamin','edible','phylloquinone'),
  ('vitamin_k_total','Vitamin K gesamt','Total vitamin K','µg','vitamin','edible',null),
  ('vitamin_b6','Vitamin B6','Vitamin B6','µg','vitamin','edible',null)
on conflict(code) do update set
  name_de=excluded.name_de,name_en=excluded.name_en,unit=excluded.unit,
  nutrient_group=excluded.nutrient_group,basis=excluded.basis,chemical_form=excluded.chemical_form;
create table public.source_components (
  source_id uuid not null references public.food_sources(id) on delete restrict,
  component_code text not null,
  name_de text not null,
  name_en text,
  unit text,
  group_code text,
  formula text,
  usage_description text,
  metadata jsonb not null default '{}'::jsonb,
  primary key (source_id,component_code)
);
create table public.nutrient_mappings (
  source_id uuid not null,
  source_component_code text not null,
  nutrient_definition_id uuid null references public.nutrient_definitions(id) on delete restrict,
  mapping_version text not null,
  mapping_status text not null check (mapping_status in ('reviewed','unmapped','excluded')),
  source_unit text,
  transform jsonb not null default '{}'::jsonb,
  reviewed_by text,
  reviewed_at timestamptz,
  primary key (source_id,source_component_code,mapping_version),
  foreign key (source_id,source_component_code) references public.source_components(source_id,component_code) on delete restrict,
  check ((mapping_status='reviewed' and nutrient_definition_id is not null) or (mapping_status<>'reviewed'))
);

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name_de text not null,
  name_en text,
  parent_id uuid null references public.categories(id) on delete restrict,
  hierarchy_version text not null default 'v1',
  created_at timestamptz not null default now(),
  check (parent_id is null or parent_id <> id)
);
create index categories_parent_idx on public.categories(parent_id,code);
create table public.foods (
  id uuid primary key default gen_random_uuid(),
  source_id uuid null references public.food_sources(id) on delete restrict,
  source_food_code text null,
  owner_household_id uuid null references public.households(id) on delete cascade,
  owner_user_id uuid null references auth.users(id) on delete cascade,
  created_by_user_id uuid null references auth.users(id) on delete set null,
  compatibility_key text,
  created_at timestamptz not null default now(),
  unique (id,owner_household_id),
  check ((source_id is not null and source_food_code is not null and owner_household_id is null and owner_user_id is null) or (source_id is null and source_food_code is null and (owner_household_id is not null or owner_user_id is not null)))
);
create unique index foods_source_code_unique on public.foods(source_id,source_food_code) where source_id is not null;
create index foods_household_idx on public.foods(owner_household_id) where owner_household_id is not null;
create table public.food_versions (
  id uuid primary key default gen_random_uuid(),
  food_id uuid not null references public.foods(id) on delete restrict,
  source_release_id uuid null references public.source_releases(id) on delete restrict,
  version_number integer not null check (version_number > 0),
  name_de text not null,
  name_en text,
  preparation_state text,
  source_notes text,
  created_at timestamptz not null default now(),
  unique (food_id,version_number),
  unique (source_release_id,food_id),
  unique (id,food_id)
);
create index food_versions_name_de_trgm on public.food_versions using gin (name_de extensions.gin_trgm_ops);
create index food_versions_release_name_idx on public.food_versions(source_release_id,name_de,id);
create table public.food_nutrient_values (
  food_version_id uuid not null references public.food_versions(id) on delete restrict,
  source_component_code text not null,
  nutrient_definition_id uuid null references public.nutrient_definitions(id) on delete restrict,
  raw_value text null,
  normalized_amount numeric null check (normalized_amount is null or (public.numeric_is_finite(normalized_amount) and normalized_amount >= 0)),
  unit text null,
  value_status text not null check (value_status in ('numeric','explicit_zero','trace','below_limit','missing','source_not_present','unsupported_mapping')),
  source_method text null,
  source_reference text null,
  mapping_version text null,
  primary key (food_version_id,source_component_code),
  check ((value_status='numeric' and normalized_amount is not null and normalized_amount>0) or (value_status='explicit_zero' and normalized_amount=0) or (value_status='unsupported_mapping' and normalized_amount is not null) or (value_status in ('trace','below_limit','missing','source_not_present') and normalized_amount is null))
);
create index food_nutrient_values_nutrient_idx on public.food_nutrient_values(nutrient_definition_id,food_version_id) where nutrient_definition_id is not null;
create table public.food_categories (
  food_version_id uuid not null references public.food_versions(id) on delete restrict,
  category_id uuid not null references public.categories(id) on delete restrict,
  is_primary boolean not null default false,
  source_category_code text,
  primary key (food_version_id,category_id)
);
create unique index one_primary_category_per_food_version on public.food_categories(food_version_id) where is_primary;
create index food_categories_category_idx on public.food_categories(category_id,food_version_id);
create table public.food_tags (
  food_version_id uuid not null references public.food_versions(id) on delete restrict,
  tag text not null check (length(btrim(tag)) between 1 and 80),
  primary key (food_version_id,tag)
);
create table public.food_synonyms (
  food_version_id uuid not null references public.food_versions(id) on delete restrict,
  synonym text not null check (length(btrim(synonym)) between 1 and 160),
  language_code text not null default 'de',
  source text not null default 'source',
  primary key (food_version_id,synonym,language_code)
);
create index food_synonyms_search_trgm on public.food_synonyms using gin (synonym extensions.gin_trgm_ops);
create table public.food_measures (
  id uuid primary key default gen_random_uuid(),
  food_version_id uuid not null references public.food_versions(id) on delete restrict,
  label text not null,
  unit text not null,
  grams_per_unit numeric not null check (public.numeric_is_finite(grams_per_unit) and grams_per_unit > 0),
  basis text not null check (basis in ('edible','purchase','drained','unknown')),
  source_reference text,
  confirmed boolean not null default false,
  created_at timestamptz not null default now(),
  unique (food_version_id,label,unit)
);

create table public.recipes (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  archived_at timestamptz,
  current_version_id uuid null,
  revision integer not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (household_id,id)
);
create index recipes_household_title_idx on public.recipes(household_id,title,id);
create trigger recipes_touch before update on public.recipes for each row execute function public.touch_updated_at();
create table public.recipe_versions (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid not null,
  household_id uuid not null,
  version_number integer not null check (version_number > 0),
  title text not null,
  description text,
  base_servings numeric null check (public.numeric_is_finite(base_servings) and base_servings > 0),
  yield_text text null,
  final_weight_g numeric null check (final_weight_g is null or (public.numeric_is_finite(final_weight_g) and final_weight_g > 0)),
  active_minutes integer null check (active_minutes is null or active_minutes >= 0),
  total_minutes integer null check (total_minutes is null or total_minutes >= 0),
  steps jsonb not null default '[]'::jsonb check (jsonb_typeof(steps)='array'),
  calculation_version text not null default 'recipe-calc-v1',
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (recipe_id,version_number),
  unique (household_id,id),
  unique (recipe_id,id),
  foreign key (household_id,recipe_id) references public.recipes(household_id,id) on delete cascade
);
alter table public.recipes add constraint recipes_current_version_fk foreign key (id,current_version_id) references public.recipe_versions(recipe_id,id) on delete set null (current_version_id) deferrable initially deferred;
create table public.recipe_ingredients (
  id uuid primary key default gen_random_uuid(),
  recipe_version_id uuid not null references public.recipe_versions(id) on delete cascade,
  position integer not null check (position >= 0),
  food_version_id uuid null references public.food_versions(id) on delete cascade,
  original_text text not null,
  quantity numeric null check (quantity is null or (public.numeric_is_finite(quantity) and quantity >= 0)),
  unit text not null default 'unknown',
  amount_basis text not null default 'unknown' check (amount_basis in ('edible','purchase','drained','unknown')),
  confirmed_grams_per_unit numeric null check (confirmed_grams_per_unit is null or (public.numeric_is_finite(confirmed_grams_per_unit) and confirmed_grams_per_unit > 0)),
  alternative_group_id text null,
  selected_alternative boolean not null default false,
  created_at timestamptz not null default now(),
  unique (recipe_version_id,position),
  check (alternative_group_id is not null or not selected_alternative)
);
create index recipe_ingredients_version_idx on public.recipe_ingredients(recipe_version_id,position);
create table public.recipe_favorites (
  user_id uuid not null references auth.users(id) on delete cascade,
  household_id uuid not null references public.households(id) on delete cascade,
  recipe_version_id uuid not null references public.recipe_versions(id) on delete cascade,
  is_favorite boolean not null,
  revision integer not null default 1 check (revision > 0),
  updated_at timestamptz not null default now(),
  primary key (user_id,household_id,recipe_version_id)
);
create index recipe_favorites_user_household_idx on public.recipe_favorites(user_id,household_id,is_favorite);

create table public.plans (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  title text not null default 'Wochenplan',
  start_date date not null,
  end_date date not null,
  status text not null default 'active' check (status in ('draft','active','archived')),
  revision integer not null default 1 check (revision > 0),
  approved_by uuid null references auth.users(id) on delete set null,
  approved_at timestamptz null,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (household_id,id),
  check (end_date >= start_date)
);
create index plans_household_dates_idx on public.plans(household_id,start_date,end_date,status);
create trigger plans_touch before update on public.plans for each row execute function public.touch_updated_at();
create table public.plan_day_completeness (
  household_id uuid not null references public.households(id) on delete cascade,
  complete_on date not null,
  complete boolean not null,
  completed_by uuid null references auth.users(id) on delete set null,
  completed_at timestamptz null,
  revision integer not null default 1 check (revision > 0),
  primary key (household_id,complete_on),
  check (complete = (completed_at is not null))
);
create table public.planned_batches (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null,
  plan_id uuid not null,
  recipe_version_id uuid not null,
  cook_date date not null,
  cook_portions numeric not null check (public.numeric_is_finite(cook_portions) and cook_portions > 0),
  final_weight_g numeric null check (final_weight_g is null or (public.numeric_is_finite(final_weight_g) and final_weight_g > 0)),
  completed boolean not null default false,
  inventory_review_required boolean not null default false,
  completed_at timestamptz null,
  revision integer not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  unique (household_id,id),
  foreign key (household_id,plan_id) references public.plans(household_id,id) on delete cascade,
  foreign key (household_id,recipe_version_id) references public.recipe_versions(household_id,id) on delete cascade
);
create index planned_batches_plan_date_idx on public.planned_batches(plan_id,cook_date,id);
create table public.meal_entries (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null,
  plan_id uuid not null,
  entry_date date not null,
  slot text not null check (slot in ('breakfast','lunch','dinner','snack','other')),
  entry_kind text not null check (entry_kind in ('recipe_batch','direct_food','flex')),
  batch_id uuid null,
  food_version_id uuid null references public.food_versions(id) on delete cascade,
  label text null,
  quantity_g numeric null check (quantity_g is null or (public.numeric_is_finite(quantity_g) and quantity_g > 0)),
  provided boolean not null default false,
  inventory_review_required boolean not null default false,
  revision integer not null default 1 check (revision > 0),
  archived_at timestamptz null,
  created_at timestamptz not null default now(),
  unique (household_id,id),
  foreign key (household_id,plan_id) references public.plans(household_id,id) on delete cascade,
  foreign key (household_id,batch_id) references public.planned_batches(household_id,id) on delete cascade,
  check ((entry_kind='recipe_batch' and batch_id is not null and food_version_id is null) or (entry_kind='direct_food' and food_version_id is not null and batch_id is null) or (entry_kind='flex' and batch_id is null and food_version_id is null))
);
create index meal_entries_plan_date_idx on public.meal_entries(household_id,plan_id,entry_date,slot,id);
create index meal_entries_batch_idx on public.meal_entries(batch_id,entry_date) where batch_id is not null;
create table public.meal_allocations (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null,
  entry_id uuid not null,
  person_id uuid not null,
  portions numeric not null check (public.numeric_is_finite(portions) and portions > 0),
  revision integer not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  unique (entry_id,person_id),
  foreign key (household_id,entry_id) references public.meal_entries(household_id,id) on delete cascade,
  foreign key (household_id,person_id) references public.persons(household_id,id) on delete restrict
);
create index meal_allocations_person_idx on public.meal_allocations(household_id,person_id,entry_id);
create table public.plan_changes (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null,
  plan_id uuid not null,
  operation_id uuid not null,
  change_kind text not null check (change_kind in ('move','swap','undo')),
  affected_entry_ids uuid[] not null,
  before_dates jsonb not null,
  after_dates jsonb not null,
  resulting_revision integer not null,
  undone_at timestamptz null,
  undone_by uuid null references auth.users(id) on delete set null,
  undo_operation_id uuid null,
  created_at timestamptz not null default now(),
  unique (operation_id),
  foreign key (household_id,plan_id) references public.plans(household_id,id) on delete cascade
);
create table public.prep_reminders (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null,
  entry_id uuid null,
  batch_id uuid null,
  reminder_date date not null,
  text text not null check (length(btrim(text)) between 1 and 500),
  done boolean not null default false,
  revision integer not null default 1,
  created_at timestamptz not null default now(),
  foreign key (household_id,entry_id) references public.meal_entries(household_id,id) on delete cascade,
  foreign key (household_id,batch_id) references public.planned_batches(household_id,id) on delete cascade,
  check (entry_id is not null or batch_id is not null)
);
create table public.cooking_checklist_items (
  household_id uuid not null,
  batch_id uuid not null,
  item_kind text not null check (item_kind in ('ingredient','step')),
  item_key text not null,
  checked boolean not null default false,
  checked_by uuid null references auth.users(id) on delete set null,
  checked_at timestamptz null,
  revision integer not null default 1,
  primary key (batch_id,item_kind,item_key),
  foreign key (household_id,batch_id) references public.planned_batches(household_id,id) on delete cascade,
  check (checked = (checked_at is not null))
);
create table public.feedback (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  recipe_id uuid null,
  recipe_version_id uuid null,
  meal_entry_id uuid null,
  person_id uuid null,
  rating smallint null check (rating between 1 and 5),
  note text,
  wish text,
  created_by uuid not null references auth.users(id) on delete restrict,
  revision integer not null default 1,
  created_at timestamptz not null default now(),
  foreign key (household_id,recipe_id) references public.recipes(household_id,id) on delete set null (recipe_id),
  foreign key (household_id,recipe_version_id) references public.recipe_versions(household_id,id) on delete set null (recipe_version_id),
  foreign key (household_id,meal_entry_id) references public.meal_entries(household_id,id) on delete set null (meal_entry_id),
  foreign key (household_id,person_id) references public.persons(household_id,id) on delete set null (person_id),
  check (recipe_id is not null or recipe_version_id is not null or meal_entry_id is not null or wish is not null)
);
create index feedback_household_created_idx on public.feedback(household_id,created_at desc);

create table public.inventory_items (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  food_version_id uuid null references public.food_versions(id) on delete cascade,
  compatibility_key text null,
  free_text text null,
  quantity numeric null check (quantity is null or (public.numeric_is_finite(quantity) and quantity >= 0)),
  unit text not null default 'unknown',
  amount_basis text not null default 'unknown' check (amount_basis in ('edible','purchase','drained','unknown')),
  grams_per_unit numeric null check (grams_per_unit is null or (public.numeric_is_finite(grams_per_unit) and grams_per_unit > 0)),
  qualitative_state text not null default 'unknown' check (qualitative_state in ('present','low','unknown')),
  storage_location text,
  status text not null default 'unknown' check (status in ('confirmed','qualitative','stale','unknown')),
  needs_review boolean not null default false,
  confirmed_at timestamptz null,
  confirmed_revision integer null,
  revision integer not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (household_id,id),
  check (food_version_id is not null or nullif(btrim(free_text),'') is not null),
  check ((status='confirmed' and quantity is not null) or status<>'confirmed')
);
create index inventory_items_household_idx on public.inventory_items(household_id,status,id);
create trigger inventory_items_touch before update on public.inventory_items for each row execute function public.touch_updated_at();
create table public.inventory_movements (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  inventory_item_id uuid not null,
  delta numeric not null check (public.numeric_is_finite(delta)),
  quantity_after numeric null check (quantity_after is null or (public.numeric_is_finite(quantity_after) and quantity_after >= 0)),
  reversal_of_id uuid null unique references public.inventory_movements(id) on delete restrict,
  unit text not null,
  reason text not null check (reason in ('purchase','consumption','correction','manual_add','manual_remove','receipt')),
  note text,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  operation_id uuid not null,
  created_at timestamptz not null default now(),
  foreign key (household_id,inventory_item_id) references public.inventory_items(household_id,id) on delete cascade
);
create index inventory_movements_item_created_idx on public.inventory_movements(inventory_item_id,created_at desc);

create table public.shopping_extras (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  food_version_id uuid null references public.food_versions(id) on delete cascade,
  label text not null check (length(btrim(label)) between 1 and 200),
  quantity numeric null check (quantity is null or (public.numeric_is_finite(quantity) and quantity > 0)),
  unit text null,
  done boolean not null default false,
  revision integer not null default 1 check (revision > 0),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (household_id,id)
);
create index shopping_extras_open_idx on public.shopping_extras(household_id,done,id);
create trigger shopping_extras_touch before update on public.shopping_extras for each row execute function public.touch_updated_at();
create table public.shopping_snapshots (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  horizon_days smallint not null check (horizon_days in (7,14)),
  source_plan_revision integer not null check (source_plan_revision >= 0),
  source_inventory_revision integer not null check (source_inventory_revision >= 0),
  state text not null default 'open' check (state in ('open','ordered','cancelled')),
  created_by uuid not null references auth.users(id) on delete restrict,
  ordered_at timestamptz null,
  order_reference text null,
  revision integer not null default 1,
  created_at timestamptz not null default now(),
  unique (household_id,id)
);
create table public.shopping_snapshot_items (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null,
  snapshot_id uuid not null,
  line_key text not null,
  food_version_id uuid null references public.food_versions(id) on delete cascade,
  label text not null,
  quantity numeric null check (quantity is null or (public.numeric_is_finite(quantity) and quantity > 0)),
  unit text not null,
  amount_basis text not null default 'unknown' check (amount_basis in ('edible','purchase','drained','unknown')),
  cause_entry_ids uuid[] not null default '{}',
  cause_batch_ids uuid[] not null default '{}',
  inventory_item_ids uuid[] not null default '{}',
  created_at timestamptz not null default now(),
  unique (snapshot_id,line_key),
  unique (household_id,id),
  foreign key (household_id,snapshot_id) references public.shopping_snapshots(household_id,id) on delete cascade
);
create table public.shopping_checkoffs (
  household_id uuid not null references public.households(id) on delete cascade,
  line_key text not null check (length(btrim(line_key)) between 1 and 500),
  source_plan_revision integer not null check (source_plan_revision >= 0),
  source_inventory_revision integer not null check (source_inventory_revision >= 0),
  line_fingerprint text null check (line_fingerprint is null or line_fingerprint ~ '^[0-9a-f]{64}$'),
  checked boolean not null,
  checked_by uuid null references auth.users(id) on delete set null,
  checked_at timestamptz null,
  revision integer not null default 1 check (revision > 0),
  updated_at timestamptz not null default now(),
  primary key (household_id,line_key),
  check (checked = (checked_at is not null))
);
create table public.procurement_positions (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null,
  snapshot_id uuid not null,
  snapshot_item_id uuid not null,
  food_version_id uuid null references public.food_versions(id) on delete restrict,
  label text not null,
  ordered_quantity numeric not null check (public.numeric_is_finite(ordered_quantity) and ordered_quantity > 0),
  received_quantity numeric not null default 0 check (public.numeric_is_finite(received_quantity) and received_quantity >= 0),
  cancelled_quantity numeric not null default 0 check (public.numeric_is_finite(cancelled_quantity) and cancelled_quantity >= 0),
  unit text not null,
  amount_basis text not null default 'unknown' check (amount_basis in ('edible','purchase','drained','unknown')),
  expected_date date null,
  status text not null default 'ordered' check (status in ('ordered','partial','received','cancelled','closed')),
  revision integer not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  unique (household_id,id),
  unique (snapshot_item_id),
  foreign key (household_id,snapshot_id) references public.shopping_snapshots(household_id,id) on delete cascade,
  foreign key (household_id,snapshot_item_id) references public.shopping_snapshot_items(household_id,id) on delete cascade,
  check (received_quantity + cancelled_quantity <= ordered_quantity)
);
create index procurement_open_idx on public.procurement_positions(household_id,status,expected_date);
create table public.procurement_receipts (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  position_id uuid not null,
  inventory_movement_id uuid not null unique references public.inventory_movements(id) on delete cascade,
  receipt_reference text null,
  quantity numeric not null check (public.numeric_is_finite(quantity) and quantity > 0),
  unit text not null,
  received_by uuid not null references auth.users(id) on delete restrict,
  operation_id uuid not null,
  received_at timestamptz not null default now(),
  foreign key (household_id,position_id) references public.procurement_positions(household_id,id) on delete cascade,
  unique (operation_id,position_id)
);
create unique index procurement_receipt_reference_unique on public.procurement_receipts(position_id,receipt_reference) where receipt_reference is not null;

create table public.merchant_preferences (
  household_id uuid primary key references public.households(id) on delete cascade,
  postal_code text null,
  city text null,
  favorite_merchant text null,
  revision integer not null default 1,
  updated_by uuid not null references auth.users(id) on delete restrict,
  updated_at timestamptz not null default now()
);
create table public.merchant_links (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  label text not null,
  url text not null check (url ~ '^https://'),
  link_type text not null check (link_type in ('product','search','store','map')),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);

create table public.operation_receipts (
  user_id uuid not null references auth.users(id) on delete cascade,
  operation_id uuid not null,
  action text not null,
  payload_hash text not null,
  result jsonb null,
  created_at timestamptz not null default now(),
  completed_at timestamptz null,
  primary key (user_id,operation_id)
);
create index operation_receipts_created_idx on public.operation_receipts(created_at);

create table public.plan_drafts (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  plan_id uuid not null,
  title text not null default 'Entwurf',
  status text not null default 'open' check (status in ('open','approved','rejected')),
  revision integer not null default 1,
  created_by uuid not null references auth.users(id) on delete restrict,
  approved_at timestamptz null,
  created_at timestamptz not null default now(),
  unique (household_id,id),
  foreign key (household_id,plan_id) references public.plans(household_id,id) on delete cascade
);
create table public.draft_entries (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null,
  draft_id uuid not null,
  entry_date date not null,
  slot text not null check (slot in ('breakfast','lunch','dinner','snack','other')),
  entry_kind text not null check (entry_kind in ('recipe','food','flex')),
  recipe_version_id uuid null references public.recipe_versions(id) on delete restrict,
  food_version_id uuid null references public.food_versions(id) on delete restrict,
  recipe_cook_portions numeric null check (recipe_cook_portions is null or (public.numeric_is_finite(recipe_cook_portions) and recipe_cook_portions > 0)),
  replaces_entry_id uuid null,
  label text null,
  quantity_g numeric null check (quantity_g is null or (public.numeric_is_finite(quantity_g) and quantity_g > 0)),
  replacement_required boolean not null default false,
  replacement_resolved boolean not null default true,
  revision integer not null default 1,
  unique (household_id,id),
  foreign key (household_id,draft_id) references public.plan_drafts(household_id,id) on delete cascade,
  foreign key (household_id,replaces_entry_id) references public.meal_entries(household_id,id) on delete restrict,
  check ((entry_kind='recipe' and recipe_version_id is not null and food_version_id is null and recipe_cook_portions is not null) or (entry_kind='food' and food_version_id is not null and recipe_version_id is null and recipe_cook_portions is null) or (entry_kind='flex' and recipe_version_id is null and food_version_id is null and recipe_cook_portions is null))
);
create table public.draft_allocations (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null,
  draft_entry_id uuid not null,
  person_id uuid not null,
  portions numeric not null check (public.numeric_is_finite(portions) and portions > 0),
  created_at timestamptz not null default now(),
  unique (draft_entry_id,person_id),
  foreign key (household_id,draft_entry_id) references public.draft_entries(household_id,id) on delete cascade,
  foreign key (household_id,person_id) references public.persons(household_id,id) on delete restrict
);

create table public.export_import_receipts (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  operation_id uuid not null,
  input_hash text not null,
  imported_counts jsonb not null,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (created_by,operation_id)
);

-- Definer membership predicates avoid recursive RLS while limiting all checks to auth.uid().
create or replace function public.has_household_role(p_household_id uuid, p_roles text[])
returns boolean language sql stable security definer set search_path = ''
as $$ select exists (select 1 from public.household_members m where m.household_id=p_household_id and m.user_id=auth.uid() and m.role=any(p_roles)) $$;
create or replace function public.is_profile_owner(p_profile_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $$ select exists (select 1 from public.private_profiles p where p.id=p_profile_id and p.owner_user_id=auth.uid()) $$;
create or replace function public.can_read_shared_targets(p_profile_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $$ select exists (select 1 from public.private_profiles p where p.id=p_profile_id and p.share_targets_with_household and public.has_household_role(p.household_id,array['owner','editor','viewer'])) $$;
create or replace function public.can_read_target_version(p_target_version_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists(
    select 1 from public.target_versions t
    join public.private_profiles p on p.id=t.profile_id
    where t.id=p_target_version_id
      and (p.owner_user_id=auth.uid() or p.share_targets_with_household
        and public.has_household_role(p.household_id,array['owner','editor','viewer']))
  )
$$;

-- Resolve food visibility without recursively applying foods/food_versions RLS.
create or replace function public.can_read_food(p_food_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists(
    select 1 from public.foods f where f.id=p_food_id and (
      (f.source_id is not null and exists(
        select 1 from public.food_versions v
        join public.source_releases r on r.id=v.source_release_id
        where v.food_id=f.id and r.status in ('active','superseded')
      ))
      or (f.owner_household_id is not null and public.has_household_role(f.owner_household_id,array['owner','editor','viewer']))
      or f.owner_user_id=auth.uid()
    )
  )
$$;

-- Public catalogue is read-only to application roles; household-owned foods require membership.
alter table public.households enable row level security;
alter table public.household_members enable row level security;
alter table public.household_invitations enable row level security;
alter table public.legacy_external_ids enable row level security;
alter table public.legacy_import_issues enable row level security;
alter table public.data_import_previews enable row level security;
alter table public.persons enable row level security;
alter table public.private_profiles enable row level security;
alter table public.profile_measurements enable row level security;
alter table public.energy_estimates enable row level security;
alter table public.reference_packs enable row level security;
alter table public.reference_values enable row level security;
alter table public.target_versions enable row level security;
alter table public.target_items enable row level security;
alter table public.target_item_private_inputs enable row level security;
alter table public.food_sources enable row level security;
alter table public.source_releases enable row level security;
alter table public.nutrient_definitions enable row level security;
alter table public.source_components enable row level security;
alter table public.nutrient_mappings enable row level security;
alter table public.categories enable row level security;
alter table public.foods enable row level security;
alter table public.food_versions enable row level security;
alter table public.food_nutrient_values enable row level security;
alter table public.food_categories enable row level security;
alter table public.food_tags enable row level security;
alter table public.food_synonyms enable row level security;
alter table public.food_measures enable row level security;
alter table public.recipes enable row level security;
alter table public.recipe_versions enable row level security;
alter table public.recipe_ingredients enable row level security;
alter table public.recipe_favorites enable row level security;
alter table public.plan_day_completeness enable row level security;
alter table public.plans enable row level security;
alter table public.planned_batches enable row level security;
alter table public.meal_entries enable row level security;
alter table public.meal_allocations enable row level security;
alter table public.plan_changes enable row level security;
alter table public.prep_reminders enable row level security;
alter table public.cooking_checklist_items enable row level security;
alter table public.feedback enable row level security;
alter table public.inventory_items enable row level security;
alter table public.inventory_movements enable row level security;
alter table public.shopping_extras enable row level security;
alter table public.shopping_snapshots enable row level security;
alter table public.shopping_snapshot_items enable row level security;
alter table public.shopping_checkoffs enable row level security;
alter table public.procurement_positions enable row level security;
alter table public.procurement_receipts enable row level security;
alter table public.merchant_preferences enable row level security;
alter table public.merchant_links enable row level security;
alter table public.operation_receipts enable row level security;
alter table public.plan_drafts enable row level security;
alter table public.draft_entries enable row level security;
alter table public.draft_allocations enable row level security;
alter table public.export_import_receipts enable row level security;

create policy households_member_read on public.households for select to authenticated using (public.has_household_role(id,array['owner','editor','viewer']));
create policy household_members_read on public.household_members for select to authenticated using (public.has_household_role(household_id,array['owner','editor','viewer']));
create policy household_invitations_manager_read on public.household_invitations for select to authenticated using (public.has_household_role(household_id,array['owner','editor']));
create policy persons_member_read on public.persons for select to authenticated using (public.has_household_role(household_id,array['owner','editor','viewer']));
create policy private_profile_owner_only on public.private_profiles for select to authenticated using (owner_user_id=auth.uid());
create policy profile_measurements_owner_only on public.profile_measurements for select to authenticated using (public.is_profile_owner(profile_id));
create policy energy_estimates_owner_only on public.energy_estimates for select to authenticated using (public.is_profile_owner(profile_id));
create policy target_versions_owner_read on public.target_versions for select to authenticated using (public.is_profile_owner(profile_id));
create policy target_items_private_or_shared_read on public.target_items for select to authenticated using (public.can_read_target_version(target_version_id));
create policy target_item_private_inputs_owner_read on public.target_item_private_inputs for select to authenticated using (public.is_profile_owner(profile_id));
create policy reference_packs_read on public.reference_packs for select to anon,authenticated using (review_status='approved');
create policy reference_values_read on public.reference_values for select to anon,authenticated using (exists(select 1 from public.reference_packs p where p.id=reference_pack_id and p.review_status='approved'));
create policy food_sources_read on public.food_sources for select to anon,authenticated using (true);
create policy source_releases_public_read on public.source_releases for select to anon,authenticated using (status in ('active','superseded'));
create policy nutrient_definitions_read on public.nutrient_definitions for select to anon,authenticated using (true);
create policy source_components_read on public.source_components for select to anon,authenticated using (true);
create policy nutrient_mappings_read on public.nutrient_mappings for select to anon,authenticated using (true);
create policy categories_read on public.categories for select to anon,authenticated using (true);
create policy foods_catalog_or_household_read on public.foods for select to anon,authenticated using (public.can_read_food(id));
create policy food_versions_catalog_or_household_read on public.food_versions for select to anon,authenticated using (exists(select 1 from public.foods f where f.id=food_id and ((f.source_id is not null and exists(select 1 from public.source_releases r where r.id=source_release_id and r.status in ('active','superseded'))) or (f.owner_household_id is not null and public.has_household_role(f.owner_household_id,array['owner','editor','viewer'])) or f.owner_user_id=auth.uid())));
create policy food_values_catalog_or_household_read on public.food_nutrient_values for select to anon,authenticated using (exists(select 1 from public.food_versions v where v.id=food_version_id));
create policy food_categories_catalog_read on public.food_categories for select to anon,authenticated using (exists(select 1 from public.food_versions v where v.id=food_version_id));
create policy food_tags_catalog_read on public.food_tags for select to anon,authenticated using (exists(select 1 from public.food_versions v where v.id=food_version_id));
create policy food_synonyms_catalog_read on public.food_synonyms for select to anon,authenticated using (exists(select 1 from public.food_versions v where v.id=food_version_id));
create policy food_measures_catalog_read on public.food_measures for select to anon,authenticated using (exists(select 1 from public.food_versions v where v.id=food_version_id));

create policy recipes_household_read on public.recipes for select to authenticated using (public.has_household_role(household_id,array['owner','editor','viewer']));
create policy recipe_versions_household_read on public.recipe_versions for select to authenticated using (public.has_household_role(household_id,array['owner','editor','viewer']));
create policy recipe_ingredients_household_read on public.recipe_ingredients for select to authenticated using (exists(select 1 from public.recipe_versions v where v.id=recipe_version_id and public.has_household_role(v.household_id,array['owner','editor','viewer'])));
create policy recipe_favorites_owner_read on public.recipe_favorites for select to authenticated using (user_id=auth.uid() and public.has_household_role(household_id,array['owner','editor','viewer']));
create policy plans_household_read on public.plans for select to authenticated using (public.has_household_role(household_id,array['owner','editor','viewer']));
create policy plan_day_completeness_household_read on public.plan_day_completeness for select to authenticated using (public.has_household_role(household_id,array['owner','editor','viewer']));
create policy batches_household_read on public.planned_batches for select to authenticated using (public.has_household_role(household_id,array['owner','editor','viewer']));
create policy entries_household_read on public.meal_entries for select to authenticated using (public.has_household_role(household_id,array['owner','editor','viewer']));
create policy allocations_household_read on public.meal_allocations for select to authenticated using (public.has_household_role(household_id,array['owner','editor','viewer']));
create policy plan_changes_household_read on public.plan_changes for select to authenticated using (public.has_household_role(household_id,array['owner','editor','viewer']));
create policy reminders_household_read on public.prep_reminders for select to authenticated using (public.has_household_role(household_id,array['owner','editor','viewer']));
create policy checklists_household_read on public.cooking_checklist_items for select to authenticated using (public.has_household_role(household_id,array['owner','editor','viewer']));
create policy feedback_household_read on public.feedback for select to authenticated using (public.has_household_role(household_id,array['owner','editor','viewer']));
create policy inventory_household_read on public.inventory_items for select to authenticated using (public.has_household_role(household_id,array['owner','editor','viewer']));
create policy movements_household_read on public.inventory_movements for select to authenticated using (public.has_household_role(household_id,array['owner','editor','viewer']));
create policy extras_household_read on public.shopping_extras for select to authenticated using (public.has_household_role(household_id,array['owner','editor','viewer']));
create policy snapshots_household_read on public.shopping_snapshots for select to authenticated using (public.has_household_role(household_id,array['owner','editor','viewer']));
create policy snapshot_items_household_read on public.shopping_snapshot_items for select to authenticated using (public.has_household_role(household_id,array['owner','editor','viewer']));
create policy shopping_checkoffs_household_read on public.shopping_checkoffs for select to authenticated using (public.has_household_role(household_id,array['owner','editor','viewer']));
create policy procurement_household_read on public.procurement_positions for select to authenticated using (public.has_household_role(household_id,array['owner','editor','viewer']));
create policy receipts_household_read on public.procurement_receipts for select to authenticated using (public.has_household_role(household_id,array['owner','editor','viewer']));
create policy merchant_prefs_household_read on public.merchant_preferences for select to authenticated using (public.has_household_role(household_id,array['owner','editor','viewer']));
create policy merchant_links_household_read on public.merchant_links for select to authenticated using (public.has_household_role(household_id,array['owner','editor','viewer']));
create policy operation_receipts_owner_read on public.operation_receipts for select to authenticated using (user_id=auth.uid());
create policy drafts_household_read on public.plan_drafts for select to authenticated using (public.has_household_role(household_id,array['owner','editor','viewer']));
create policy draft_entries_household_read on public.draft_entries for select to authenticated using (public.has_household_role(household_id,array['owner','editor','viewer']));
create policy draft_allocations_household_read on public.draft_allocations for select to authenticated using (public.has_household_role(household_id,array['owner','editor','viewer']));
create policy import_receipts_household_read on public.export_import_receipts for select to authenticated using (created_by=auth.uid() and public.has_household_role(household_id,array['owner','editor','viewer']));
create policy legacy_external_ids_household_read on public.legacy_external_ids for select to authenticated using (public.has_household_role(household_id,array['owner','editor','viewer']));
create policy legacy_import_issues_household_read on public.legacy_import_issues for select to authenticated using (public.has_household_role(household_id,array['owner','editor','viewer']));
create policy data_import_previews_owner_read on public.data_import_previews for select to authenticated using (user_id=auth.uid() and public.has_household_role(household_id,array['owner','editor']));

-- Explicit grants: authenticated users can read through RLS and invoke RPCs, never write tables directly.
grant usage on schema public to anon, authenticated;
grant select on public.food_sources,public.source_releases,public.nutrient_definitions,public.source_components,public.nutrient_mappings,public.categories,public.foods,public.food_versions,public.food_nutrient_values,public.food_categories,public.food_tags,public.food_measures,public.reference_packs,public.reference_values to anon,authenticated;
grant select on public.households,public.household_members,public.persons,public.private_profiles,public.profile_measurements,public.energy_estimates,public.target_versions,public.target_items,public.recipes,public.recipe_versions,public.recipe_ingredients,public.plans,public.planned_batches,public.meal_entries,public.meal_allocations,public.plan_changes,public.prep_reminders,public.cooking_checklist_items,public.feedback,public.inventory_items,public.inventory_movements,public.shopping_extras,public.shopping_snapshots,public.shopping_snapshot_items,public.procurement_positions,public.procurement_receipts,public.merchant_preferences,public.merchant_links,public.operation_receipts,public.plan_drafts,public.draft_entries,public.export_import_receipts to authenticated;
grant select on public.target_item_private_inputs to authenticated;
grant select on public.plan_day_completeness to authenticated;
grant select on public.shopping_checkoffs to authenticated;
grant select on public.household_invitations,public.legacy_external_ids,public.legacy_import_issues to authenticated;
grant select on public.food_synonyms to anon,authenticated;
grant select on public.draft_allocations to authenticated;
grant select on public.recipe_favorites to authenticated;
revoke select on public.operation_receipts from authenticated;
revoke insert,update,delete,truncate,references,trigger on all tables in schema public from anon,authenticated;
grant execute on function public.has_household_role(uuid,text[]),public.is_profile_owner(uuid),public.can_read_shared_targets(uuid),public.can_read_target_version(uuid),public.can_read_food(uuid) to anon,authenticated;

-- User data must never be available through a cross-user/shared cache.
comment on table public.private_profiles is 'Private by owner_user_id; household membership never grants access to body measurements.';
comment on table public.operation_receipts is 'Idempotency receipts are stored in the same transaction as each command mutation.';
comment on table public.food_nutrient_values is 'Source marker and normalized numeric value are stored separately; null is never coerced to zero.';
