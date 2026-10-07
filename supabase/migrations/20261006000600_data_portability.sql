create table public.data_import_sources (
  target_household_id uuid not null references public.households(id) on delete cascade,
  source_household_id uuid not null,
  source_hash text not null check (source_hash ~ '^[0-9a-f]{64}$'),
  imported_by uuid not null references auth.users(id) on delete restrict,
  imported_at timestamptz not null default now(),
  primary key (target_household_id,source_household_id)
);
alter table public.data_import_sources enable row level security;
create policy data_import_sources_read on public.data_import_sources for select to authenticated
  using (public.has_household_role(target_household_id,array['owner','editor']));
grant select on public.data_import_sources to authenticated;

create or replace function app_private.json_record_numbers_as_strings(p_table text,p_row jsonb)
returns jsonb language plpgsql stable set search_path = ''
as $$
declare v_result jsonb:=p_row; v_column text;
begin
  for v_column in
    select column_name from information_schema.columns
    where table_schema='public' and table_name=p_table and data_type='numeric'
  loop
    if jsonb_typeof(v_result->v_column)='number' then
      v_result:=jsonb_set(v_result,array[v_column],to_jsonb(v_result->>v_column),false);
    end if;
  end loop;
  return v_result;
end $$;

create or replace function app_private.export_household_rows(p_table text,p_household uuid,p_profile uuid,p_user uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare v_from text; v_where text; v_remove text[]:='{}'; v_sql text; v_rows jsonb;
begin
  if p_profile is not null and p_table not in (
    'persons','private_profiles','profile_measurements','energy_estimates',
    'target_versions','target_items','target_item_private_inputs'
  ) then return '[]'::jsonb; end if;
  case p_table
    when 'persons' then
      v_from:='public.persons x';
      v_where:='x.household_id=$1 and ($2 is null or exists(
        select 1 from public.private_profiles p
        where p.id=$2 and p.person_id=x.id and p.owner_user_id=$3
      ))';
      v_remove:=array['linked_user_id'];
    when 'private_profiles' then v_from:='public.private_profiles x'; v_where:='x.household_id=$1 and x.id=$2 and x.owner_user_id=$3'; v_remove:=array['owner_user_id'];
    when 'profile_measurements' then v_from:='public.profile_measurements x'; v_where:='x.profile_id=$2 and exists(select 1 from public.private_profiles p where p.id=x.profile_id and p.household_id=$1 and p.owner_user_id=$3)';
    when 'energy_estimates' then v_from:='public.energy_estimates x'; v_where:='x.profile_id=$2 and exists(select 1 from public.private_profiles p where p.id=x.profile_id and p.household_id=$1 and p.owner_user_id=$3)';
    when 'target_versions' then v_from:='public.target_versions x'; v_where:='x.household_id=$1 and x.profile_id=$2 and exists(select 1 from public.private_profiles p where p.id=x.profile_id and p.owner_user_id=$3)';
    when 'target_items' then v_from:='public.target_items x join public.target_versions t on t.id=x.target_version_id'; v_where:='t.household_id=$1 and t.profile_id=$2 and exists(select 1 from public.private_profiles p where p.id=t.profile_id and p.owner_user_id=$3)';
    when 'target_item_private_inputs' then v_from:='public.target_item_private_inputs x join public.target_versions t on t.id=x.target_version_id'; v_where:='t.household_id=$1 and t.profile_id=$2 and exists(select 1 from public.private_profiles p where p.id=t.profile_id and p.owner_user_id=$3)';
    when 'foods' then v_from:='public.foods x'; v_where:='x.owner_household_id=$1'; v_remove:=array['owner_user_id','created_by_user_id'];
    when 'food_versions' then v_from:='public.food_versions x join public.foods f on f.id=x.food_id'; v_where:='f.owner_household_id=$1';
    when 'food_nutrient_values' then v_from:='public.food_nutrient_values x join public.food_versions v on v.id=x.food_version_id join public.foods f on f.id=v.food_id'; v_where:='f.owner_household_id=$1';
    when 'food_categories' then v_from:='public.food_categories x join public.food_versions v on v.id=x.food_version_id join public.foods f on f.id=v.food_id'; v_where:='f.owner_household_id=$1';
    when 'food_tags' then v_from:='public.food_tags x join public.food_versions v on v.id=x.food_version_id join public.foods f on f.id=v.food_id'; v_where:='f.owner_household_id=$1';
    when 'food_synonyms' then v_from:='public.food_synonyms x join public.food_versions v on v.id=x.food_version_id join public.foods f on f.id=v.food_id'; v_where:='f.owner_household_id=$1';
    when 'food_measures' then v_from:='public.food_measures x join public.food_versions v on v.id=x.food_version_id join public.foods f on f.id=v.food_id'; v_where:='f.owner_household_id=$1';
    when 'recipes' then v_from:='public.recipes x'; v_where:='x.household_id=$1'; v_remove:=array['owner_user_id'];
    when 'recipe_versions' then v_from:='public.recipe_versions x'; v_where:='x.household_id=$1'; v_remove:=array['created_by'];
    when 'recipe_ingredients' then v_from:='public.recipe_ingredients x join public.recipe_versions v on v.id=x.recipe_version_id'; v_where:='v.household_id=$1';
    when 'recipe_favorites' then v_from:='public.recipe_favorites x'; v_where:='x.household_id=$1 and x.user_id=$3'; v_remove:=array['user_id'];
    when 'plans' then v_from:='public.plans x'; v_where:='x.household_id=$1'; v_remove:=array['created_by','approved_by'];
    when 'plan_day_completeness' then v_from:='public.plan_day_completeness x'; v_where:='x.household_id=$1'; v_remove:=array['completed_by'];
    when 'planned_batches' then v_from:='public.planned_batches x'; v_where:='x.household_id=$1';
    when 'meal_entries' then v_from:='public.meal_entries x'; v_where:='x.household_id=$1';
    when 'meal_allocations' then v_from:='public.meal_allocations x'; v_where:='x.household_id=$1';
    when 'plan_changes' then v_from:='public.plan_changes x'; v_where:='x.household_id=$1'; v_remove:=array['undone_by','undo_operation_id'];
    when 'prep_reminders' then v_from:='public.prep_reminders x'; v_where:='x.household_id=$1';
    when 'cooking_checklist_items' then v_from:='public.cooking_checklist_items x'; v_where:='x.household_id=$1'; v_remove:=array['checked_by'];
    when 'feedback' then v_from:='public.feedback x'; v_where:='x.household_id=$1'; v_remove:=array['created_by'];
    when 'plan_drafts' then v_from:='public.plan_drafts x'; v_where:='x.household_id=$1'; v_remove:=array['created_by'];
    when 'draft_entries' then v_from:='public.draft_entries x'; v_where:='x.household_id=$1';
    when 'draft_allocations' then v_from:='public.draft_allocations x'; v_where:='x.household_id=$1';
    when 'inventory_items' then v_from:='public.inventory_items x'; v_where:='x.household_id=$1';
    when 'inventory_movements' then v_from:='public.inventory_movements x'; v_where:='x.household_id=$1'; v_remove:=array['actor_user_id','operation_id'];
    when 'shopping_extras' then v_from:='public.shopping_extras x'; v_where:='x.household_id=$1'; v_remove:=array['created_by'];
    when 'shopping_snapshots' then v_from:='public.shopping_snapshots x'; v_where:='x.household_id=$1'; v_remove:=array['created_by'];
    when 'shopping_snapshot_items' then v_from:='public.shopping_snapshot_items x'; v_where:='x.household_id=$1';
    when 'shopping_checkoffs' then v_from:='public.shopping_checkoffs x'; v_where:='x.household_id=$1'; v_remove:=array['checked_by'];
    when 'procurement_positions' then v_from:='public.procurement_positions x'; v_where:='x.household_id=$1';
    when 'procurement_receipts' then v_from:='public.procurement_receipts x'; v_where:='x.household_id=$1'; v_remove:=array['received_by','operation_id','reversed_by'];
    when 'merchant_preferences' then v_from:='public.merchant_preferences x'; v_where:='x.household_id=$1'; v_remove:=array['updated_by'];
    when 'merchant_links' then v_from:='public.merchant_links x'; v_where:='x.household_id=$1'; v_remove:=array['created_by'];
    when 'legacy_external_ids' then v_from:='public.legacy_external_ids x'; v_where:='x.household_id=$1';
    when 'legacy_import_issues' then v_from:='public.legacy_import_issues x'; v_where:='x.household_id=$1';
    else raise exception using message='VALIDATION',errcode='P0001';
  end case;
  v_sql:='select coalesce(jsonb_agg(app_private.json_record_numbers_as_strings($5,to_jsonb(x)-$4::text[]) order by to_jsonb(x)::text),''[]''::jsonb) from '||v_from||' where '||v_where;
  execute v_sql into v_rows using p_household,p_profile,p_user,v_remove,p_table;
  return coalesce(v_rows,'[]'::jsonb);
end $$;

create or replace function public.export_household_data(p_household_id uuid,p_profile_id uuid default null)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare v_household public.households%rowtype; v_profile uuid;
begin
  if auth.uid() is null then perform app_private.fail('AUTH_REQUIRED'); end if;
  if not public.has_household_role(p_household_id,array['owner','editor','viewer']) then perform app_private.fail('FORBIDDEN'); end if;
  select * into v_household from public.households where id=p_household_id;
  if not found then perform app_private.fail('NOT_FOUND'); end if;
  if p_profile_id is not null then
    select id into v_profile from public.private_profiles where id=p_profile_id and household_id=p_household_id and owner_user_id=auth.uid();
    if not found then perform app_private.fail('FORBIDDEN'); end if;
  end if;
  return jsonb_build_object(
    'schema','supper-board-household-export-v1','exportedAt',now(),'sourceHouseholdId',p_household_id,
    'household',jsonb_build_object('name',v_household.name,'locale',v_household.locale,'countryCode',v_household.country_code,'currency',v_household.currency,'timeZone',v_household.time_zone),
    'records',jsonb_build_object(
      'persons',app_private.export_household_rows('persons',p_household_id,v_profile,auth.uid()),
      'private_profiles',app_private.export_household_rows('private_profiles',p_household_id,v_profile,auth.uid()),
      'profile_measurements',app_private.export_household_rows('profile_measurements',p_household_id,v_profile,auth.uid()),
      'energy_estimates',app_private.export_household_rows('energy_estimates',p_household_id,v_profile,auth.uid()),
      'target_versions',app_private.export_household_rows('target_versions',p_household_id,v_profile,auth.uid()),
      'target_items',app_private.export_household_rows('target_items',p_household_id,v_profile,auth.uid()),
      'target_item_private_inputs',app_private.export_household_rows('target_item_private_inputs',p_household_id,v_profile,auth.uid()),
      'foods',app_private.export_household_rows('foods',p_household_id,v_profile,auth.uid()),
      'food_versions',app_private.export_household_rows('food_versions',p_household_id,v_profile,auth.uid()),
      'food_nutrient_values',app_private.export_household_rows('food_nutrient_values',p_household_id,v_profile,auth.uid()),
      'food_categories',app_private.export_household_rows('food_categories',p_household_id,v_profile,auth.uid()),
      'food_tags',app_private.export_household_rows('food_tags',p_household_id,v_profile,auth.uid()),
      'food_synonyms',app_private.export_household_rows('food_synonyms',p_household_id,v_profile,auth.uid()),
      'food_measures',app_private.export_household_rows('food_measures',p_household_id,v_profile,auth.uid()),
      'recipes',app_private.export_household_rows('recipes',p_household_id,v_profile,auth.uid()),
      'recipe_versions',app_private.export_household_rows('recipe_versions',p_household_id,v_profile,auth.uid()),
      'recipe_ingredients',app_private.export_household_rows('recipe_ingredients',p_household_id,v_profile,auth.uid()),
      'recipe_favorites',app_private.export_household_rows('recipe_favorites',p_household_id,v_profile,auth.uid()),
      'plans',app_private.export_household_rows('plans',p_household_id,v_profile,auth.uid()),
      'plan_day_completeness',app_private.export_household_rows('plan_day_completeness',p_household_id,v_profile,auth.uid()),
      'planned_batches',app_private.export_household_rows('planned_batches',p_household_id,v_profile,auth.uid()),
      'meal_entries',app_private.export_household_rows('meal_entries',p_household_id,v_profile,auth.uid()),
      'meal_allocations',app_private.export_household_rows('meal_allocations',p_household_id,v_profile,auth.uid()),
      'plan_changes',app_private.export_household_rows('plan_changes',p_household_id,v_profile,auth.uid()),
      'prep_reminders',app_private.export_household_rows('prep_reminders',p_household_id,v_profile,auth.uid()),
      'cooking_checklist_items',app_private.export_household_rows('cooking_checklist_items',p_household_id,v_profile,auth.uid()),
      'feedback',app_private.export_household_rows('feedback',p_household_id,v_profile,auth.uid()),
      'plan_drafts',app_private.export_household_rows('plan_drafts',p_household_id,v_profile,auth.uid()),
      'draft_entries',app_private.export_household_rows('draft_entries',p_household_id,v_profile,auth.uid()),
      'draft_allocations',app_private.export_household_rows('draft_allocations',p_household_id,v_profile,auth.uid()),
      'inventory_items',app_private.export_household_rows('inventory_items',p_household_id,v_profile,auth.uid()),
      'inventory_movements',app_private.export_household_rows('inventory_movements',p_household_id,v_profile,auth.uid()),
      'shopping_extras',app_private.export_household_rows('shopping_extras',p_household_id,v_profile,auth.uid()),
      'shopping_snapshots',app_private.export_household_rows('shopping_snapshots',p_household_id,v_profile,auth.uid()),
      'shopping_snapshot_items',app_private.export_household_rows('shopping_snapshot_items',p_household_id,v_profile,auth.uid()),
      'shopping_checkoffs',app_private.export_household_rows('shopping_checkoffs',p_household_id,v_profile,auth.uid()),
      'procurement_positions',app_private.export_household_rows('procurement_positions',p_household_id,v_profile,auth.uid()),
      'procurement_receipts',app_private.export_household_rows('procurement_receipts',p_household_id,v_profile,auth.uid()),
      'merchant_preferences',app_private.export_household_rows('merchant_preferences',p_household_id,v_profile,auth.uid()),
      'merchant_links',app_private.export_household_rows('merchant_links',p_household_id,v_profile,auth.uid()),
      'legacy_external_ids',app_private.export_household_rows('legacy_external_ids',p_household_id,v_profile,auth.uid()),
      'legacy_import_issues',app_private.export_household_rows('legacy_import_issues',p_household_id,v_profile,auth.uid())
    ),
    'portableIdentities',app_private.export_portable_identities(p_household_id,v_profile)
  );
end $$;
create or replace function app_private.portable_referenced_food_version_ids(p_household uuid)
returns table(food_version_id uuid) language sql stable security definer set search_path = ''
as $$
  select ri.food_version_id from public.recipe_ingredients ri
  join public.recipe_versions rv on rv.id=ri.recipe_version_id
  where rv.household_id=p_household and ri.food_version_id is not null
  union
  select x.food_version_id from public.meal_entries x where x.household_id=p_household and x.food_version_id is not null
  union
  select x.food_version_id from public.draft_entries x where x.household_id=p_household and x.food_version_id is not null
  union
  select x.food_version_id from public.inventory_items x where x.household_id=p_household and x.food_version_id is not null
  union
  select x.food_version_id from public.shopping_extras x where x.household_id=p_household and x.food_version_id is not null
  union
  select x.food_version_id from public.shopping_snapshot_items x where x.household_id=p_household and x.food_version_id is not null
  union
  select x.food_version_id from public.procurement_positions x where x.household_id=p_household and x.food_version_id is not null
$$;

create or replace function app_private.food_version_calculation_provenance(p_food_version uuid)
returns jsonb language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'nutrients',coalesce((
      select jsonb_agg(jsonb_build_object(
        'componentCode',n.source_component_code,'mappingVersion',n.mapping_version,
        'nutrientCode',d.code,'unit',n.unit,'valueStatus',n.value_status,
        'normalizedAmount',n.normalized_amount::text
      ) order by n.source_component_code)
      from public.food_nutrient_values n
      left join public.nutrient_definitions d on d.id=n.nutrient_definition_id
      where n.food_version_id=p_food_version
    ),'[]'::jsonb),
    'categories',coalesce((
      select jsonb_agg(jsonb_build_object(
        'taxonomyVersion',c.hierarchy_version,'code',c.code,
        'isPrimary',fc.is_primary,'sourceCategoryCode',fc.source_category_code
      ) order by c.hierarchy_version,c.code)
      from public.food_categories fc
      join public.categories c on c.id=fc.category_id
      where fc.food_version_id=p_food_version
    ),'[]'::jsonb)
  )
$$;

create or replace function app_private.export_portable_identities(p_household uuid,p_profile uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare
  v_food_versions jsonb; v_categories jsonb; v_nutrients jsonb;
  v_reference_packs jsonb; v_reference_values jsonb;
begin
  select coalesce(jsonb_object_agg(v.id::text,jsonb_build_object(
      'sourceCode',s.code,'releaseCode',r.release_code,'sourceSha256',r.source_sha256,
      'sourceFoodCode',f.source_food_code,'versionNumber',v.version_number,
      'nutrientBasis',v.nutrient_basis,
      'calculationProvenance',app_private.food_version_calculation_provenance(v.id)
    )),'{}'::jsonb)
  into v_food_versions
  from app_private.portable_referenced_food_version_ids(p_household) refs
  join public.food_versions v on v.id=refs.food_version_id
  join public.foods f on f.id=v.food_id
  join public.source_releases r on r.id=v.source_release_id
  join public.food_sources s on s.id=r.source_id
  where p_profile is null and f.source_id is not null and f.source_id=r.source_id;

  select coalesce(jsonb_object_agg(c.id::text,jsonb_build_object(
      'taxonomyVersion',c.hierarchy_version,'code',c.code
    )),'{}'::jsonb)
  into v_categories
  from public.categories c
  where p_profile is null and c.id in (
    select fc.category_id from public.food_categories fc
    join public.food_versions v on v.id=fc.food_version_id
    join public.foods f on f.id=v.food_id
    where f.owner_household_id=p_household
    union
    select fc.category_id from public.food_categories fc
    join app_private.portable_referenced_food_version_ids(p_household) refs on refs.food_version_id=fc.food_version_id
  );

  select coalesce(jsonb_object_agg(d.id::text,jsonb_build_object('code',d.code)),'{}'::jsonb)
  into v_nutrients
  from public.nutrient_definitions d
  where p_profile is null and exists(
    select 1 from public.food_nutrient_values n
    join public.food_versions v on v.id=n.food_version_id
    join public.foods f on f.id=v.food_id
    where f.owner_household_id=p_household and n.nutrient_definition_id=d.id
  );

  select coalesce(jsonb_object_agg(rp.id::text,jsonb_build_object('code',rp.code,'version',rp.version)),'{}'::jsonb)
  into v_reference_packs
  from public.reference_packs rp
  where p_profile is not null and (
    exists(select 1 from public.target_versions t where t.profile_id=p_profile and t.reference_pack_id=rp.id)
    or exists(select 1 from public.target_items i join public.target_versions t on t.id=i.target_version_id
      where t.profile_id=p_profile and i.reference_pack_id=rp.id)
  );

  select coalesce(jsonb_object_agg(rv.id::text,jsonb_build_object(
      'packCode',rp.code,'packVersion',rp.version,'immutableKey',rv.immutable_key
    )),'{}'::jsonb)
  into v_reference_values
  from public.reference_values rv
  join public.reference_packs rp on rp.id=rv.reference_pack_id
  where p_profile is not null and exists(
    select 1 from public.target_items i join public.target_versions t on t.id=i.target_version_id
    where t.profile_id=p_profile and i.reference_value_id=rv.id and i.reference_pack_id=rv.reference_pack_id
  );

  return jsonb_build_object(
    'foodVersions',v_food_versions,'categories',v_categories,
    'nutrientDefinitions',v_nutrients,'referencePacks',v_reference_packs,
    'referenceValues',v_reference_values
  );
end $$;
create or replace function app_private.resolve_portable_identity(p_identities jsonb,p_kind text,p_source_id text)
returns uuid language plpgsql stable security definer set search_path = ''
as $$
declare
  v_identity jsonb; v_count integer; v_ids uuid[];
begin
  if p_kind not in ('foodVersions','categories','nutrientDefinitions','referencePacks','referenceValues')
    or p_source_id is null then return null; end if;
  v_identity:=p_identities->p_kind->p_source_id;
  if jsonb_typeof(v_identity) is distinct from 'object' then return null; end if;
  case p_kind
    when 'foodVersions' then
      select count(*),array_agg(v.id order by v.id) into v_count,v_ids
      from public.food_versions v
      join public.foods f on f.id=v.food_id
      join public.source_releases r on r.id=v.source_release_id and r.source_id=f.source_id
      join public.food_sources s on s.id=r.source_id
      where s.code=v_identity->>'sourceCode'
        and r.release_code=v_identity->>'releaseCode'
        and r.source_sha256=v_identity->>'sourceSha256'
        and r.status in ('active','superseded')
        and f.source_food_code=v_identity->>'sourceFoodCode'
        and v.version_number=(v_identity->>'versionNumber')::integer
        and v.nutrient_basis=v_identity->>'nutrientBasis'
        and app_private.food_version_calculation_provenance(v.id)=v_identity->'calculationProvenance';
    when 'categories' then
      select count(*),array_agg(c.id order by c.id) into v_count,v_ids
      from public.categories c
      where c.code=v_identity->>'code'
        and c.hierarchy_version=v_identity->>'taxonomyVersion';
    when 'nutrientDefinitions' then
      select count(*),array_agg(n.id order by n.id) into v_count,v_ids
      from public.nutrient_definitions n where n.code=v_identity->>'code';
    when 'referencePacks' then
      select count(*),array_agg(rp.id order by rp.id) into v_count,v_ids
      from public.reference_packs rp
      where rp.code=v_identity->>'code' and rp.version=v_identity->>'version';
    when 'referenceValues' then
      select count(*),array_agg(rv.id order by rv.id) into v_count,v_ids
      from public.reference_values rv
      join public.reference_packs rp on rp.id=rv.reference_pack_id
      where rp.code=v_identity->>'packCode'
        and rp.version=v_identity->>'packVersion'
        and rv.immutable_key=v_identity->>'immutableKey';
  end case;
  if v_count<>1 then return null; end if;
  return v_ids[1];
exception when others then
  return null;
end $$;
create or replace function app_private.portable_import_uuid_maps(p_identities jsonb)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare
  v_pair record; v_source_id text; v_map jsonb; v_result jsonb:='{}'::jsonb; v_resolved uuid;
begin
  if p_identities is null or jsonb_typeof(p_identities)='null' then return v_result; end if;
  if jsonb_typeof(p_identities) is distinct from 'object' then perform app_private.fail('IMPORT_SCHEMA'); end if;
  for v_pair in
    select * from (values
      ('foodVersions','food_versions'),('categories','categories'),
      ('nutrientDefinitions','nutrient_definitions'),('referencePacks','reference_packs'),
      ('referenceValues','reference_values')
    ) as identity_map(identity_table,target_table)
  loop
    v_map:='{}'::jsonb;
    if jsonb_typeof(coalesce(p_identities->v_pair.identity_table,'{}'::jsonb)) is distinct from 'object'
    then perform app_private.fail('IMPORT_SCHEMA'); end if;
    for v_source_id in select key from jsonb_each(coalesce(p_identities->v_pair.identity_table,'{}'::jsonb)) loop
      v_resolved:=app_private.resolve_portable_identity(p_identities,v_pair.identity_table,v_source_id);
      if v_resolved is null then perform app_private.fail('IMPORT_CONFLICT'); end if;
      v_map:=v_map||jsonb_build_object(v_source_id,v_resolved::text);
    end loop;
    v_result:=v_result||jsonb_build_object(v_pair.target_table,v_map);
  end loop;
  return v_result;
end $$;

create or replace function public.preview_import_data(p_command jsonb)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  p jsonb:=p_command->'payload'; v_replay jsonb; v_document jsonb:=p->'document';
  v_household uuid:=(p->>'householdId')::uuid; v_source uuid; v_revision integer;
  v_name text; v_counts jsonb:='{}'::jsonb; v_table text; v_token text; v_hash text; v_existing_hash text; v_id uuid; v_reference_pack uuid; v_date date; v_row jsonb; v_conflicts jsonb:='[]'::jsonb; v_report jsonb;
  v_identities jsonb; v_identity jsonb; v_resolved uuid; v_source_id text;
  v_map jsonb; v_preview_ids jsonb:='{}'::jsonb; v_import_row jsonb; v_plan_id uuid; v_affected_ids uuid[];
  v_id_tables text[]:=array['persons','private_profiles','profile_measurements','energy_estimates','target_versions','target_items','foods','food_versions','food_measures','recipes','recipe_versions','recipe_ingredients','plans','planned_batches','meal_entries','meal_allocations','plan_changes','prep_reminders','feedback','plan_drafts','draft_entries','draft_allocations','inventory_items','inventory_movements','shopping_extras','shopping_snapshots','shopping_snapshot_items','procurement_positions','procurement_receipts','merchant_links','legacy_external_ids','legacy_import_issues'];
  v_preview uuid; v_expiry timestamptz; v_op uuid:=(p_command->>'operationId')::uuid; v_result jsonb;
  v_required text[]:=array['persons','private_profiles','profile_measurements','energy_estimates','target_versions','target_items','target_item_private_inputs','foods','food_versions','food_nutrient_values','food_categories','food_tags','food_synonyms','food_measures','recipes','recipe_versions','recipe_ingredients','recipe_favorites','plans','plan_day_completeness','planned_batches','meal_entries','meal_allocations','plan_changes','prep_reminders','cooking_checklist_items','feedback','plan_drafts','draft_entries','draft_allocations','inventory_items','inventory_movements','shopping_extras','shopping_snapshots','shopping_snapshot_items','shopping_checkoffs','procurement_positions','procurement_receipts','merchant_preferences','merchant_links','legacy_external_ids','legacy_import_issues'];
begin
  v_replay:=app_private.claim_command('preview_import_data',p_command); if v_replay is not null then return v_replay; end if;
  perform app_private.assert_role(v_household,array['owner','editor']);
  select revision,name into v_revision,v_name from public.households where id=v_household;
  if not found then perform app_private.fail('NOT_FOUND'); end if;
  perform app_private.assert_revision(p_command,v_household,v_revision);
  if jsonb_typeof(v_document) is distinct from 'object' or octet_length(v_document::text)>25000000
    or v_document->>'schema'<>'supper-board-household-export-v1'
    or jsonb_typeof(v_document->'household') is distinct from 'object'
    or jsonb_typeof(v_document->'records') is distinct from 'object'
  then perform app_private.fail('IMPORT_SCHEMA'); end if;
  begin v_source:=(v_document->>'sourceHouseholdId')::uuid; exception when others then perform app_private.fail('IMPORT_SCHEMA'); end;
  if v_source is null or v_source=v_household then perform app_private.fail('IMPORT_SCHEMA'); end if;
  v_identities:=coalesce(v_document->'portableIdentities','{}'::jsonb);
  if jsonb_typeof(v_identities) is distinct from 'object' then perform app_private.fail('IMPORT_SCHEMA'); end if;
  foreach v_table in array v_required loop
    if jsonb_typeof(v_document->'records'->v_table) is distinct from 'array' then perform app_private.fail('IMPORT_SCHEMA'); end if;
    if exists(select 1 from jsonb_array_elements(v_document->'records'->v_table) r(value) where jsonb_typeof(r.value) is distinct from 'object')
    then perform app_private.fail('IMPORT_SCHEMA'); end if;
    v_counts:=v_counts||jsonb_build_object(v_table,jsonb_array_length(v_document->'records'->v_table));
  end loop;
  foreach v_table in array v_id_tables loop
    if exists(select 1 from jsonb_array_elements(v_document->'records'->v_table) r(value) where nullif(r.value->>'id','') is null)
    then perform app_private.fail('IMPORT_SCHEMA'); end if;
    if exists(select r.value->>'id' from jsonb_array_elements(v_document->'records'->v_table) r(value) group by r.value->>'id' having count(*)>1)
    then perform app_private.fail('IMPORT_SCHEMA'); end if;
    for v_row in select value from jsonb_array_elements(v_document->'records'->v_table) loop
      begin
        v_id:=(v_row->>'id')::uuid;
        if v_id::text is distinct from v_row->>'id' then perform app_private.fail('IMPORT_SCHEMA'); end if;
      exception when others then perform app_private.fail('IMPORT_SCHEMA'); end;
    end loop;
  end loop;
  foreach v_table in array array['foodVersions','categories','nutrientDefinitions','referencePacks','referenceValues'] loop
    if jsonb_typeof(coalesce(v_identities->v_table,'{}'::jsonb)) is distinct from 'object'
      or exists(select 1 from jsonb_each(coalesce(v_identities->v_table,'{}'::jsonb)) i where jsonb_typeof(i.value) is distinct from 'object')
    then perform app_private.fail('IMPORT_SCHEMA'); end if;
    for v_source_id in select key from jsonb_each(coalesce(v_identities->v_table,'{}'::jsonb)) loop
      begin
        v_id:=v_source_id::uuid;
        if v_id::text is distinct from v_source_id then perform app_private.fail('IMPORT_SCHEMA'); end if;
      exception when others then perform app_private.fail('IMPORT_SCHEMA'); end;
    end loop;
  end loop;
  -- A source UUID cannot be both an imported local version and a global identity.
  if exists(
    select 1
    from jsonb_each(coalesce(v_identities->'foodVersions','{}'::jsonb)) logical
    join jsonb_array_elements(v_document->'records'->'food_versions') local_version(value)
      on logical.key::uuid=(local_version.value->>'id')::uuid
  ) then perform app_private.fail('IMPORT_SCHEMA'); end if;
  if jsonb_array_length(v_document->'records'->'private_profiles')>1 then perform app_private.fail('IMPORT_SCHEMA'); end if;
  v_token:=encode(extensions.gen_random_bytes(32),'hex');
  v_hash:=encode(extensions.digest(convert_to(v_document::text,'UTF8'),'sha256'),'hex');
  select source_hash into v_existing_hash from public.data_import_sources
    where target_household_id=v_household and source_household_id=v_source;
  if v_existing_hash is not null and v_existing_hash<>v_hash
  then v_conflicts:=v_conflicts||jsonb_build_array(jsonb_build_object('code','SOURCE_ALREADY_IMPORTED')); end if;
  if v_existing_hash is null or v_existing_hash<>v_hash then
    if jsonb_array_length(v_document->'records'->'merchant_preferences')>0
      and exists(select 1 from public.merchant_preferences where household_id=v_household)
    then v_conflicts:=v_conflicts||jsonb_build_array(jsonb_build_object('code','MERCHANT_PREFERENCES_EXISTS')); end if;
    begin
      for v_row in select value from jsonb_array_elements(v_document->'records'->'plan_day_completeness') loop
        v_id:=null; v_date:=(v_row->>'complete_on')::date;
        if exists(select 1 from public.plan_day_completeness c where c.household_id=v_household and c.complete_on=v_date)
        then v_conflicts:=v_conflicts||jsonb_build_array(jsonb_build_object('code','PLAN_DAY_EXISTS')); end if;
      end loop;
      for v_row in select value from jsonb_array_elements(v_document->'records'->'shopping_checkoffs') loop
        if nullif(btrim(v_row->>'line_key'),'') is null then perform app_private.fail('IMPORT_SCHEMA'); end if;
        if exists(select 1 from public.shopping_checkoffs c where c.household_id=v_household and c.line_key=v_row->>'line_key')
        then v_conflicts:=v_conflicts||jsonb_build_array(jsonb_build_object('code','SHOPPING_CHECKOFF_EXISTS')); end if;
      end loop;
    exception when others then perform app_private.fail('IMPORT_SCHEMA'); end;
    for v_row in select value from jsonb_array_elements(v_document->'records'->'legacy_external_ids') loop
      if exists(select 1 from public.legacy_external_ids x where x.household_id=v_household
        and x.source_system=v_row->>'source_system' and x.external_id=v_row->>'external_id')
      then v_conflicts:=v_conflicts||jsonb_build_array(jsonb_build_object('code','LEGACY_EXTERNAL_ID_EXISTS')); end if;
    end loop;
  end if;
  begin
    if exists(select 1 from jsonb_array_elements(v_document->'records'->'foods') x
      where nullif(x.value->>'source_id','') is not null or nullif(x.value->>'source_food_code','') is not null)
      or exists(select 1 from jsonb_array_elements(v_document->'records'->'food_versions') x
        where nullif(x.value->>'source_release_id','') is not null)
    then perform app_private.fail('IMPORT_SCHEMA'); end if;
    for v_row in select value from jsonb_array_elements(v_document->'records'->'food_versions') loop
      if not exists(select 1 from jsonb_array_elements(v_document->'records'->'foods') f(value)
        where (f.value->>'id')::uuid=(v_row->>'food_id')::uuid)
      then perform app_private.fail('IMPORT_SCHEMA'); end if;
    end loop;
    foreach v_table in array array['food_nutrient_values','food_categories','food_tags','food_synonyms','food_measures'] loop
      for v_row in select value from jsonb_array_elements(v_document->'records'->v_table) loop
        if not exists(select 1 from jsonb_array_elements(v_document->'records'->'food_versions') f(value)
          where (f.value->>'id')::uuid=(v_row->>'food_version_id')::uuid)
        then perform app_private.fail('IMPORT_SCHEMA'); end if;
      end loop;
    end loop;
    for v_row in select value from jsonb_array_elements(v_document->'records'->'persons') loop
      if (v_row->>'household_id')::uuid is distinct from v_source then perform app_private.fail('IMPORT_SCHEMA'); end if;
    end loop;
    for v_row in select value from jsonb_array_elements(v_document->'records'->'private_profiles') loop
      if (v_row->>'household_id')::uuid is distinct from v_source
        or (v_row ? 'imported_unverified' and jsonb_typeof(v_row->'imported_unverified') is distinct from 'boolean')
        or not exists(select 1 from jsonb_array_elements(v_document->'records'->'persons') p(value)
          where (p.value->>'id')::uuid=(v_row->>'person_id')::uuid)
      then perform app_private.fail('IMPORT_SCHEMA'); end if;
    end loop;
    for v_row in select value from jsonb_array_elements(v_document->'records'->'profile_measurements') loop
      if not exists(select 1 from jsonb_array_elements(v_document->'records'->'private_profiles') p(value)
        where (p.value->>'id')::uuid=(v_row->>'profile_id')::uuid)
      then perform app_private.fail('IMPORT_SCHEMA'); end if;
    end loop;
    for v_row in select value from jsonb_array_elements(v_document->'records'->'energy_estimates') loop
      if jsonb_typeof(v_row->'input_snapshot') is distinct from 'object'
        or not exists(select 1 from jsonb_array_elements(v_document->'records'->'private_profiles') p(value)
          where (p.value->>'id')::uuid=(v_row->>'profile_id')::uuid)
      then perform app_private.fail('IMPORT_SCHEMA'); end if;
    end loop;
    for v_row in select value from jsonb_array_elements(v_document->'records'->'target_versions') loop
      if (v_row->>'household_id')::uuid is distinct from v_source
        or not exists(select 1 from jsonb_array_elements(v_document->'records'->'private_profiles') p(value)
          where (p.value->>'id')::uuid=(v_row->>'profile_id')::uuid)
      then perform app_private.fail('IMPORT_SCHEMA'); end if;
    end loop;
    for v_row in select value from jsonb_array_elements(v_document->'records'->'target_items') loop
      if coalesce(v_row->>'target_kind','') not in ('point','range','minimum','maximum')
        or not exists(select 1 from jsonb_array_elements(v_document->'records'->'target_versions') t(value)
        where (t.value->>'id')::uuid=(v_row->>'target_version_id')::uuid)
      then perform app_private.fail('IMPORT_SCHEMA'); end if;
    end loop;
    for v_row in select value from jsonb_array_elements(v_document->'records'->'target_item_private_inputs') loop
      if not exists(select 1 from jsonb_array_elements(v_document->'records'->'target_items') i(value)
          where (i.value->>'id')::uuid=(v_row->>'target_item_id')::uuid
            and (i.value->>'target_version_id')::uuid=(v_row->>'target_version_id')::uuid)
        or not exists(select 1 from jsonb_array_elements(v_document->'records'->'target_versions') t(value)
          where (t.value->>'id')::uuid=(v_row->>'target_version_id')::uuid
            and (t.value->>'profile_id')::uuid=(v_row->>'profile_id')::uuid)
      then perform app_private.fail('IMPORT_SCHEMA'); end if;
    end loop;
  exception when others then perform app_private.fail('IMPORT_SCHEMA'); end;

  for v_row in select value from jsonb_array_elements(v_document->'records'->'plan_changes') loop
    v_affected_ids:=app_private.validate_import_uuid_array(
      v_row->'affected_entry_ids',v_document->'records','meal_entries'
    );
    begin v_plan_id:=(v_row->>'plan_id')::uuid; exception when others then perform app_private.fail('IMPORT_SCHEMA'); end;
    if v_plan_id::text is distinct from v_row->>'plan_id'
      or not exists(select 1 from jsonb_array_elements(v_document->'records'->'plans') p0(value)
        where (p0.value->>'id')::uuid=v_plan_id)
    then perform app_private.fail('IMPORT_SCHEMA'); end if;
    perform app_private.validate_import_plan_state(v_row->'before_dates',v_document->'records',v_plan_id,v_affected_ids);
    perform app_private.validate_import_plan_state(v_row->'after_dates',v_document->'records',v_plan_id,v_affected_ids);
    if jsonb_array_length(v_row->'affected_entry_ids')=0
      or exists(
        select a.value#>>'{}' from jsonb_array_elements(v_row->'affected_entry_ids') a(value)
        group by a.value#>>'{}' having count(*)>1
      )
      or jsonb_array_length(v_row->'before_dates'->'entries')<>jsonb_array_length(v_row->'affected_entry_ids')
      or jsonb_array_length(v_row->'after_dates'->'entries')<>jsonb_array_length(v_row->'affected_entry_ids')
      or exists(
        select 1 from jsonb_array_elements(v_row->'affected_entry_ids') a(value)
        where not exists(select 1 from jsonb_array_elements(v_row->'before_dates'->'entries') e(value)
          where e.value->>'id'=a.value#>>'{}')
          or not exists(select 1 from jsonb_array_elements(v_row->'after_dates'->'entries') e(value)
            where e.value->>'id'=a.value#>>'{}')
      )
    then perform app_private.fail('IMPORT_SCHEMA'); end if;
  end loop;
  for v_row in select value from jsonb_array_elements(v_document->'records'->'shopping_snapshot_items') loop
    perform app_private.validate_import_uuid_array(v_row->'cause_entry_ids',v_document->'records','meal_entries');
    perform app_private.validate_import_uuid_array(v_row->'cause_batch_ids',v_document->'records','planned_batches');
    perform app_private.validate_import_uuid_array(v_row->'inventory_item_ids',v_document->'records','inventory_items');
  end loop;
  foreach v_table in array array['recipe_ingredients','meal_entries','draft_entries','inventory_items','shopping_extras','shopping_snapshot_items','procurement_positions'] loop
    for v_row in select value from jsonb_array_elements(v_document->'records'->v_table) loop
      if nullif(v_row->>'food_version_id','') is not null then
        begin v_id:=(v_row->>'food_version_id')::uuid; exception when others then perform app_private.fail('IMPORT_SCHEMA'); end;
        if not exists(select 1 from jsonb_array_elements(v_document->'records'->'food_versions') f(value)
            where (f.value->>'id')::uuid=v_id)
          and not (coalesce(v_identities->'foodVersions','{}'::jsonb) ? v_id::text)
        then v_conflicts:=v_conflicts||jsonb_build_array(jsonb_build_object('code','FOOD_VERSION_NOT_AVAILABLE')); end if;
      end if;
    end loop;
  end loop;
  for v_row in select value from jsonb_array_elements(v_document->'records'->'food_categories') loop
    begin v_id:=(v_row->>'category_id')::uuid; exception when others then perform app_private.fail('IMPORT_SCHEMA'); end;
    if not (coalesce(v_identities->'categories','{}'::jsonb) ? v_id::text)
    then v_conflicts:=v_conflicts||jsonb_build_array(jsonb_build_object('code','CATEGORY_NOT_AVAILABLE')); end if;
  end loop;
  for v_row in select value from jsonb_array_elements(v_document->'records'->'food_nutrient_values') loop
    if nullif(v_row->>'nutrient_definition_id','') is not null then
      begin v_id:=(v_row->>'nutrient_definition_id')::uuid; exception when others then perform app_private.fail('IMPORT_SCHEMA'); end;
      if not (coalesce(v_identities->'nutrientDefinitions','{}'::jsonb) ? v_id::text)
      then v_conflicts:=v_conflicts||jsonb_build_array(jsonb_build_object('code','NUTRIENT_NOT_AVAILABLE')); end if;
    end if;
  end loop;
  for v_row in select value from jsonb_array_elements(v_document->'records'->'target_versions') loop
    if nullif(v_row->>'reference_pack_id','') is not null then
      begin v_id:=(v_row->>'reference_pack_id')::uuid; exception when others then perform app_private.fail('IMPORT_SCHEMA'); end;
      if not (coalesce(v_identities->'referencePacks','{}'::jsonb) ? v_id::text)
      then v_conflicts:=v_conflicts||jsonb_build_array(jsonb_build_object('code','REFERENCE_PACK_NOT_AVAILABLE')); end if;
    end if;
  end loop;
  for v_row in select value from jsonb_array_elements(v_document->'records'->'target_items') loop
    if (nullif(v_row->>'reference_value_id','') is null) is distinct from (nullif(v_row->>'reference_pack_id','') is null)
    then perform app_private.fail('IMPORT_SCHEMA'); end if;
    if nullif(v_row->>'reference_value_id','') is not null then
      begin
        v_id:=(v_row->>'reference_value_id')::uuid;
        v_reference_pack:=(v_row->>'reference_pack_id')::uuid;
      exception when others then perform app_private.fail('IMPORT_SCHEMA'); end;
      v_identity:=v_identities->'referenceValues'->v_id::text;
      if jsonb_typeof(v_identity)='object'
        and jsonb_typeof(v_identities->'referencePacks'->(v_reference_pack::text))='object'
        and ((v_identity->>'packCode') is distinct from (v_identities->'referencePacks'->(v_reference_pack::text)->>'code')
          or (v_identity->>'packVersion') is distinct from (v_identities->'referencePacks'->(v_reference_pack::text)->>'version'))
      then perform app_private.fail('IMPORT_SCHEMA'); end if;
      if not (coalesce(v_identities->'referencePacks','{}'::jsonb) ? v_reference_pack::text)
      then v_conflicts:=v_conflicts||jsonb_build_array(jsonb_build_object('code','REFERENCE_PACK_NOT_AVAILABLE')); end if;
      if not (coalesce(v_identities->'referenceValues','{}'::jsonb) ? v_id::text)
      then v_conflicts:=v_conflicts||jsonb_build_array(jsonb_build_object('code','REFERENCE_VALUE_NOT_AVAILABLE')); end if;
    end if;
  end loop;
  foreach v_table in array array['foodVersions','categories','nutrientDefinitions','referencePacks','referenceValues'] loop
    for v_source_id in select key from jsonb_each(coalesce(v_identities->v_table,'{}'::jsonb)) loop
      if app_private.resolve_portable_identity(v_identities,v_table,v_source_id) is null then
        v_conflicts:=v_conflicts||jsonb_build_array(jsonb_build_object('code',
          case v_table
            when 'foodVersions' then 'FOOD_VERSION_NOT_AVAILABLE'
            when 'categories' then 'CATEGORY_NOT_AVAILABLE'
            when 'nutrientDefinitions' then 'NUTRIENT_NOT_AVAILABLE'
            when 'referencePacks' then 'REFERENCE_PACK_NOT_AVAILABLE'
            when 'referenceValues' then 'REFERENCE_VALUE_NOT_AVAILABLE'
          end));
      end if;
    end loop;
  end loop;
  if jsonb_array_length(v_conflicts)=0 then
    foreach v_table in array v_id_tables loop
      select coalesce(jsonb_object_agg(r.value->>'id',r.value->>'id'),'{}'::jsonb)
        into v_map
        from jsonb_array_elements(v_document->'records'->v_table) r(value)
        where r.value ? 'id';
      v_preview_ids:=v_preview_ids||jsonb_build_object(v_table,v_map);
    end loop;
    v_map:=app_private.portable_import_uuid_maps(v_identities);
    for v_table in select jsonb_object_keys(v_map) loop
      v_preview_ids:=jsonb_set(v_preview_ids,array[v_table],
        coalesce(v_preview_ids->v_table,'{}'::jsonb)||(v_map->v_table),true);
    end loop;
    foreach v_table in array v_required loop
      for v_row in select value from jsonb_array_elements(v_document->'records'->v_table) loop
        perform app_private.prepare_portable_import_row(v_table,v_row,v_household,auth.uid(),v_preview_ids);
      end loop;
    end loop;
  end if;
  v_expiry:=now()+interval '30 minutes';
  v_report:=jsonb_build_object('sourceHouseholdId',v_source,'targetHouseholdId',v_household,'targetName',v_name,
    'counts',v_counts,'conflicts',v_conflicts,'alreadyImported',coalesce(v_existing_hash=v_hash,false),'warnings','[]'::jsonb);
  insert into public.data_import_previews(household_id,user_id,token_hash,input_hash,input_payload,report,expires_at)
  values(v_household,auth.uid(),encode(extensions.digest(convert_to(v_token,'UTF8'),'sha256'),'hex'),v_hash,v_document,v_report,v_expiry)
  returning id into v_preview;
  v_result:=jsonb_build_object('operationId',v_op,'replayed',false,'result',jsonb_build_object('previewId',v_preview,'previewToken',v_token,'report',v_report,'expiresAt',v_expiry),'revisions',jsonb_build_object());
  perform app_private.complete_command(v_op,v_result); return v_result;
end $$;
create or replace function app_private.import_map_uuid(p_ids jsonb,p_table text,p_source_id text)
returns uuid language plpgsql immutable set search_path = ''
as $$
declare v_id uuid; v_mapped text;
begin
  if p_source_id is null then return null; end if;
  begin v_id:=p_source_id::uuid; exception when others then perform app_private.fail('IMPORT_SCHEMA'); end;
  v_mapped:=p_ids->p_table->>(v_id::text);
  if v_mapped is null then perform app_private.fail('IMPORT_SCHEMA'); end if;
  return v_mapped::uuid;
end $$;

create or replace function app_private.remap_import_field(p_row jsonb,p_field text,p_table text,p_ids jsonb)
returns jsonb language plpgsql immutable set search_path = ''
as $$
declare v_id uuid;
begin
  if p_row->>p_field is null then return p_row; end if;
  v_id:=app_private.import_map_uuid(p_ids,p_table,p_row->>p_field);
  return jsonb_set(p_row,array[p_field],to_jsonb(v_id),true);
end $$;

create or replace function app_private.remap_import_uuid_array(p_value jsonb,p_table text,p_ids jsonb)
returns jsonb language plpgsql immutable set search_path = ''
as $$
declare v_result jsonb:='[]'::jsonb; v_item jsonb;
begin
  if jsonb_typeof(p_value) is distinct from 'array' then perform app_private.fail('IMPORT_SCHEMA'); end if;
  for v_item in select value from jsonb_array_elements(p_value) loop
    if jsonb_typeof(v_item) is distinct from 'string' then perform app_private.fail('IMPORT_SCHEMA'); end if;
    v_result:=v_result||jsonb_build_array(to_jsonb(app_private.import_map_uuid(p_ids,p_table,v_item#>>'{}')));
  end loop;
  return v_result;
end $$;

create or replace function app_private.validate_import_uuid_array(p_value jsonb,p_records jsonb,p_table text)
returns uuid[] language plpgsql immutable set search_path = ''
as $$
declare v_ids uuid[]:='{}'::uuid[]; v_id uuid; v_item jsonb;
begin
  if p_table not in ('meal_entries','planned_batches','inventory_items')
    or jsonb_typeof(p_records->p_table) is distinct from 'array'
    or jsonb_typeof(p_value) is distinct from 'array'
  then perform app_private.fail('IMPORT_SCHEMA'); end if;
  for v_item in select value from jsonb_array_elements(p_value) loop
    if jsonb_typeof(v_item) is distinct from 'string' then perform app_private.fail('IMPORT_SCHEMA'); end if;
    begin
      v_id:=(v_item#>>'{}')::uuid;
      if v_id::text is distinct from v_item#>>'{}' then perform app_private.fail('IMPORT_SCHEMA'); end if;
    exception when others then perform app_private.fail('IMPORT_SCHEMA'); end;
    if not exists(
      select 1 from jsonb_array_elements(p_records->p_table) r(value)
      where (r.value->>'id')::uuid=v_id
    ) then perform app_private.fail('IMPORT_SCHEMA'); end if;
    v_ids:=array_append(v_ids,v_id);
  end loop;
  return v_ids;
end $$;

create or replace function app_private.validate_import_plan_state(p_state jsonb,p_records jsonb,p_plan_id uuid,p_affected_entry_ids uuid[])
returns void language plpgsql immutable set search_path = ''
as $$
declare
  v_part record; v_item jsonb; v_id uuid; v_date date; v_revision integer;
begin
  if jsonb_typeof(p_state) is distinct from 'object' then perform app_private.fail('IMPORT_SCHEMA'); end if;
  if (select count(*) from jsonb_object_keys(p_state))<>3 or not (p_state ?& array['entries','batches','reminders'])
  then perform app_private.fail('IMPORT_SCHEMA'); end if;
  for v_part in
    select * from (values
      ('entries','meal_entries','date',4),
      ('batches','planned_batches','cookDate',3),
      ('reminders','prep_reminders','date',3)
    ) as state_part(state_key,record_table,date_field,field_count)
  loop
    if jsonb_typeof(p_state->v_part.state_key) is distinct from 'array'
    then perform app_private.fail('IMPORT_SCHEMA'); end if;
    for v_item in select value from jsonb_array_elements(p_state->v_part.state_key) loop
      if jsonb_typeof(v_item) is distinct from 'object' then perform app_private.fail('IMPORT_SCHEMA'); end if;
      if (select count(*) from jsonb_object_keys(v_item))<>v_part.field_count
        or jsonb_typeof(v_item->'id') is distinct from 'string'
        or jsonb_typeof(v_item->v_part.date_field) is distinct from 'string'
        or jsonb_typeof(v_item->'revision') is distinct from 'number'
        or (v_item->>'revision') !~ '^[1-9][0-9]*$'
      then perform app_private.fail('IMPORT_SCHEMA'); end if;
      if v_part.state_key='entries'
        and (jsonb_typeof(v_item->'slot') is distinct from 'string'
          or v_item->>'slot' not in ('breakfast','lunch','dinner','snack','other'))
      then perform app_private.fail('IMPORT_SCHEMA'); end if;
      begin
        v_id:=(v_item->>'id')::uuid;
        if v_id::text is distinct from v_item->>'id' then perform app_private.fail('IMPORT_SCHEMA'); end if;
        v_date:=(v_item->>v_part.date_field)::date;
        v_revision:=(v_item->>'revision')::integer;
      exception when others then perform app_private.fail('IMPORT_SCHEMA'); end;
      if v_revision<1 or not exists(
        select 1 from jsonb_array_elements(p_records->v_part.record_table) r(value)
        where (r.value->>'id')::uuid=v_id
          and (v_part.state_key<>'entries' or (r.value->>'plan_id')::uuid=p_plan_id)
      ) then perform app_private.fail('IMPORT_SCHEMA'); end if;
      if v_part.state_key='batches' and not exists(
        select 1 from jsonb_array_elements(p_records->'planned_batches') b(value)
        where (b.value->>'id')::uuid=v_id and (b.value->>'plan_id')::uuid=p_plan_id
          and exists(select 1 from jsonb_array_elements(p_records->'meal_entries') e(value)
            where (e.value->>'id')::uuid=any(p_affected_entry_ids)
              and (e.value->>'plan_id')::uuid=p_plan_id
              and (e.value->>'batch_id')::uuid=v_id)
      ) then perform app_private.fail('IMPORT_SCHEMA'); end if;
      if v_part.state_key='reminders' and not exists(
        select 1 from jsonb_array_elements(p_records->'prep_reminders') r(value)
        where (r.value->>'id')::uuid=v_id
          and ((nullif(r.value->>'entry_id','') is null)
            or exists(select 1 from jsonb_array_elements(p_records->'meal_entries') e(value)
              where (e.value->>'id')::uuid=(r.value->>'entry_id')::uuid
                and (e.value->>'plan_id')::uuid=p_plan_id))
          and ((nullif(r.value->>'batch_id','') is null)
            or exists(select 1 from jsonb_array_elements(p_records->'planned_batches') b(value)
              where (b.value->>'id')::uuid=(r.value->>'batch_id')::uuid
                and (b.value->>'plan_id')::uuid=p_plan_id))
          and (
            (nullif(r.value->>'entry_id','') is not null
              and (r.value->>'entry_id')::uuid=any(p_affected_entry_ids))
            or exists(select 1 from jsonb_array_elements(p_records->'planned_batches') b(value)
              where (b.value->>'id')::uuid=(r.value->>'batch_id')::uuid
                and (b.value->>'plan_id')::uuid=p_plan_id
                and exists(select 1 from jsonb_array_elements(p_records->'meal_entries') e(value)
                  where (e.value->>'id')::uuid=any(p_affected_entry_ids)
                    and (e.value->>'plan_id')::uuid=p_plan_id
                    and (e.value->>'batch_id')::uuid=(b.value->>'id')::uuid))
          )
      ) then perform app_private.fail('IMPORT_SCHEMA'); end if;
    end loop;
    if exists(
      select i.value->>'id' from jsonb_array_elements(p_state->v_part.state_key) i(value)
      group by i.value->>'id' having count(*)>1
    ) then perform app_private.fail('IMPORT_SCHEMA'); end if;
  end loop;
exception when others then perform app_private.fail('IMPORT_SCHEMA');

end $$;
create or replace function app_private.remap_import_plan_state(p_state jsonb,p_ids jsonb)
returns jsonb language plpgsql immutable set search_path = ''
as $$
declare v_result jsonb:='{}'::jsonb; v_part record; v_item jsonb; v_array jsonb; v_table text;
begin
  if jsonb_typeof(p_state) is distinct from 'object' then perform app_private.fail('IMPORT_SCHEMA'); end if;
  if (select count(*) from jsonb_object_keys(p_state))<>3 or not (p_state ?& array['entries','batches','reminders'])
  then perform app_private.fail('IMPORT_SCHEMA'); end if;
  for v_part in select key,value from jsonb_each(p_state) loop
    v_table:=case v_part.key when 'entries' then 'meal_entries' when 'batches' then 'planned_batches' when 'reminders' then 'prep_reminders' else null end;
    if v_table is null or jsonb_typeof(v_part.value) is distinct from 'array' then perform app_private.fail('IMPORT_SCHEMA'); end if;
    v_array:='[]'::jsonb;
    for v_item in select value from jsonb_array_elements(v_part.value) loop
      if jsonb_typeof(v_item) is distinct from 'object'
        or jsonb_typeof(v_item->'id') is distinct from 'string'
      then perform app_private.fail('IMPORT_SCHEMA'); end if;
      v_array:=v_array||jsonb_build_array(jsonb_set(v_item,'{id}',to_jsonb(app_private.import_map_uuid(p_ids,v_table,v_item->>'id')),true));
    end loop;
    v_result:=jsonb_set(v_result,array[v_part.key],v_array,true);
  end loop;
  return v_result;
end $$;

create or replace function app_private.prepare_portable_import_row(p_table text,p_row jsonb,p_household uuid,p_user uuid,p_ids jsonb)
returns jsonb language plpgsql volatile set search_path = ''
as $$
declare v jsonb:=p_row; v_entity text;
begin
  if jsonb_typeof(v)<>'object' then perform app_private.fail('IMPORT_SCHEMA'); end if;
  if v ? 'id' then v:=jsonb_set(v,'{id}',to_jsonb(app_private.import_map_uuid(p_ids,p_table,v->>'id')),true); end if;
  if v ? 'household_id' then v:=jsonb_set(v,'{household_id}',to_jsonb(p_household),true); end if;
  case p_table
    when 'persons' then v:=jsonb_set(v,'{linked_user_id}','null'::jsonb,true);
    when 'private_profiles' then
      v:=jsonb_set(v,'{owner_user_id}',to_jsonb(p_user),true);
      v:=jsonb_set(v,'{person_id}',to_jsonb(app_private.import_map_uuid(p_ids,'persons',v->>'person_id')),true);
      v:=jsonb_set(v,'{share_targets_with_household}','false'::jsonb,true);
      v:=jsonb_set(v,'{imported_unverified}','true'::jsonb,true);
    when 'profile_measurements' then v:=app_private.remap_import_field(v,'profile_id','private_profiles',p_ids);
    when 'energy_estimates' then
      v:=app_private.remap_import_field(v,'profile_id','private_profiles',p_ids);
      v:=jsonb_set(v,'{imported_unverified}','true'::jsonb,true);
    when 'target_versions' then
      v:=app_private.remap_import_field(v,'profile_id','private_profiles',p_ids);
      v:=app_private.remap_import_field(v,'reference_pack_id','reference_packs',p_ids);
      v:=jsonb_set(v,'{household_id}',to_jsonb(p_household),true);
      v:=jsonb_set(v,'{imported_unverified}','true'::jsonb,true);
    when 'target_items' then
      v:=app_private.remap_import_field(v,'target_version_id','target_versions',p_ids);
      v:=app_private.remap_import_field(v,'reference_pack_id','reference_packs',p_ids);
      v:=app_private.remap_import_field(v,'reference_value_id','reference_values',p_ids);
    when 'target_item_private_inputs' then
      v:=app_private.remap_import_field(v,'target_item_id','target_items',p_ids);
      v:=app_private.remap_import_field(v,'target_version_id','target_versions',p_ids);
      v:=app_private.remap_import_field(v,'profile_id','private_profiles',p_ids);
    when 'foods' then
      v:=jsonb_set(v,'{source_id}','null'::jsonb,true);
      v:=jsonb_set(v,'{source_food_code}','null'::jsonb,true);
      v:=jsonb_set(v,'{owner_household_id}',to_jsonb(p_household),true);
      v:=jsonb_set(v,'{owner_user_id}','null'::jsonb,true);
      v:=jsonb_set(v,'{created_by_user_id}',to_jsonb(p_user),true);
    when 'food_versions' then v:=app_private.remap_import_field(v,'food_id','foods',p_ids);
    when 'food_nutrient_values' then
      v:=app_private.remap_import_field(v,'food_version_id','food_versions',p_ids);
      v:=app_private.remap_import_field(v,'nutrient_definition_id','nutrient_definitions',p_ids);
    when 'food_categories' then
      v:=app_private.remap_import_field(v,'food_version_id','food_versions',p_ids);
      v:=app_private.remap_import_field(v,'category_id','categories',p_ids);
    when 'food_tags','food_synonyms','food_measures' then
      v:=app_private.remap_import_field(v,'food_version_id','food_versions',p_ids);
    when 'recipes' then
      v:=jsonb_set(v,'{owner_user_id}',to_jsonb(p_user),true);
      v:=app_private.remap_import_field(v,'current_version_id','recipe_versions',p_ids);
    when 'recipe_versions' then
      v:=app_private.remap_import_field(v,'recipe_id','recipes',p_ids);
      v:=jsonb_set(v,'{created_by}',to_jsonb(p_user),true);
    when 'recipe_ingredients' then
      v:=app_private.remap_import_field(v,'recipe_version_id','recipe_versions',p_ids);
      v:=app_private.remap_import_field(v,'food_version_id','food_versions',p_ids);
    when 'recipe_favorites' then
      v:=jsonb_set(v,'{user_id}',to_jsonb(p_user),true);
      v:=app_private.remap_import_field(v,'recipe_version_id','recipe_versions',p_ids);
    when 'plans' then
      v:=jsonb_set(v,'{created_by}',to_jsonb(p_user),true);
      v:=jsonb_set(v,'{approved_by}','null'::jsonb,true);
    when 'plan_day_completeness' then v:=jsonb_set(v,'{completed_by}','null'::jsonb,true);
    when 'planned_batches' then
      v:=app_private.remap_import_field(v,'plan_id','plans',p_ids);
      v:=app_private.remap_import_field(v,'recipe_version_id','recipe_versions',p_ids);
    when 'meal_entries' then
      v:=app_private.remap_import_field(v,'plan_id','plans',p_ids);
      v:=app_private.remap_import_field(v,'batch_id','planned_batches',p_ids);
      v:=app_private.remap_import_field(v,'food_version_id','food_versions',p_ids);
    when 'meal_allocations' then
      v:=app_private.remap_import_field(v,'entry_id','meal_entries',p_ids);
      v:=app_private.remap_import_field(v,'person_id','persons',p_ids);
    when 'plan_changes' then
      v:=app_private.remap_import_field(v,'plan_id','plans',p_ids);
      v:=jsonb_set(v,'{affected_entry_ids}',app_private.remap_import_uuid_array(v->'affected_entry_ids','meal_entries',p_ids),true);
      v:=jsonb_set(v,'{before_dates}',app_private.remap_import_plan_state(v->'before_dates',p_ids),true);
      v:=jsonb_set(v,'{after_dates}',app_private.remap_import_plan_state(v->'after_dates',p_ids),true);
      v:=jsonb_set(v,'{operation_id}',to_jsonb(pg_catalog.gen_random_uuid()),true);
      v:=jsonb_set(v,'{undone_by}','null'::jsonb,true);
      v:=jsonb_set(v,'{undo_operation_id}','null'::jsonb,true);
    when 'prep_reminders' then
      v:=app_private.remap_import_field(v,'entry_id','meal_entries',p_ids);
      v:=app_private.remap_import_field(v,'batch_id','planned_batches',p_ids);
    when 'cooking_checklist_items' then
      v:=app_private.remap_import_field(v,'batch_id','planned_batches',p_ids);
      v:=jsonb_set(v,'{checked_by}','null'::jsonb,true);
    when 'feedback' then
      v:=app_private.remap_import_field(v,'recipe_id','recipes',p_ids);
      v:=app_private.remap_import_field(v,'recipe_version_id','recipe_versions',p_ids);
      v:=app_private.remap_import_field(v,'meal_entry_id','meal_entries',p_ids);
      v:=app_private.remap_import_field(v,'person_id','persons',p_ids);
      v:=jsonb_set(v,'{created_by}',to_jsonb(p_user),true);
    when 'plan_drafts' then
      v:=app_private.remap_import_field(v,'plan_id','plans',p_ids);
      v:=jsonb_set(v,'{created_by}',to_jsonb(p_user),true);
    when 'draft_entries' then
      v:=app_private.remap_import_field(v,'draft_id','plan_drafts',p_ids);
      v:=app_private.remap_import_field(v,'recipe_version_id','recipe_versions',p_ids);
      v:=app_private.remap_import_field(v,'food_version_id','food_versions',p_ids);
      v:=app_private.remap_import_field(v,'replaces_entry_id','meal_entries',p_ids);
    when 'draft_allocations' then
      v:=app_private.remap_import_field(v,'draft_entry_id','draft_entries',p_ids);
      v:=app_private.remap_import_field(v,'person_id','persons',p_ids);
    when 'inventory_items' then v:=app_private.remap_import_field(v,'food_version_id','food_versions',p_ids);
    when 'inventory_movements' then
      v:=app_private.remap_import_field(v,'inventory_item_id','inventory_items',p_ids);
      v:=app_private.remap_import_field(v,'reversal_of_id','inventory_movements',p_ids);
      v:=jsonb_set(v,'{actor_user_id}',to_jsonb(p_user),true);
      v:=jsonb_set(v,'{operation_id}',to_jsonb(pg_catalog.gen_random_uuid()),true);
    when 'shopping_extras' then
      v:=app_private.remap_import_field(v,'food_version_id','food_versions',p_ids);
      v:=jsonb_set(v,'{created_by}',to_jsonb(p_user),true);
    when 'shopping_snapshots' then v:=jsonb_set(v,'{created_by}',to_jsonb(p_user),true);
    when 'shopping_snapshot_items' then
      v:=app_private.remap_import_field(v,'snapshot_id','shopping_snapshots',p_ids);
      v:=app_private.remap_import_field(v,'food_version_id','food_versions',p_ids);
      v:=jsonb_set(v,'{cause_entry_ids}',app_private.remap_import_uuid_array(v->'cause_entry_ids','meal_entries',p_ids),true);
      v:=jsonb_set(v,'{cause_batch_ids}',app_private.remap_import_uuid_array(v->'cause_batch_ids','planned_batches',p_ids),true);
      v:=jsonb_set(v,'{inventory_item_ids}',app_private.remap_import_uuid_array(v->'inventory_item_ids','inventory_items',p_ids),true);
    when 'shopping_checkoffs' then v:=jsonb_set(v,'{checked_by}','null'::jsonb,true);
    when 'procurement_positions' then
      v:=app_private.remap_import_field(v,'snapshot_id','shopping_snapshots',p_ids);
      v:=app_private.remap_import_field(v,'snapshot_item_id','shopping_snapshot_items',p_ids);
      v:=app_private.remap_import_field(v,'food_version_id','food_versions',p_ids);
    when 'procurement_receipts' then
      v:=app_private.remap_import_field(v,'position_id','procurement_positions',p_ids);
      v:=app_private.remap_import_field(v,'inventory_movement_id','inventory_movements',p_ids);
      v:=app_private.remap_import_field(v,'reversal_movement_id','inventory_movements',p_ids);
      v:=jsonb_set(v,'{received_by}',to_jsonb(p_user),true);
      v:=jsonb_set(v,'{reversed_by}','null'::jsonb,true);
      v:=jsonb_set(v,'{operation_id}',to_jsonb(pg_catalog.gen_random_uuid()),true);
    when 'merchant_preferences' then v:=jsonb_set(v,'{updated_by}',to_jsonb(p_user),true);
    when 'merchant_links' then v:=jsonb_set(v,'{created_by}',to_jsonb(p_user),true);
    when 'legacy_external_ids' then
      v_entity:=case v->>'entity_type'
        when 'person' then 'persons' when 'recipe' then 'recipes' when 'recipe_version' then 'recipe_versions'
        when 'ingredient' then 'recipe_ingredients' when 'plan' then 'plans' when 'batch' then 'planned_batches'
        when 'meal_entry' then 'meal_entries' when 'inventory_item' then 'inventory_items'
        when 'inventory_movement' then 'inventory_movements' when 'feedback' then 'feedback'
        when 'shopping_extra' then 'shopping_extras' when 'shopping_snapshot' then 'shopping_snapshots'
        when 'shopping_snapshot_item' then 'shopping_snapshot_items' when 'procurement_position' then 'procurement_positions'
        when 'procurement_receipt' then 'procurement_receipts' when 'draft' then 'plan_drafts'
        when 'draft_entry' then 'draft_entries' when 'reminder' then 'prep_reminders' else null end;
      if v_entity is not null then
        v:=jsonb_set(v,'{internal_id}',to_jsonb(app_private.import_map_uuid(p_ids,v_entity,v->>'internal_id')),true);
      end if;
    else null;
  end case;
  return v;
end $$;

create or replace function app_private.insert_portable_import_row(p_table text,p_row jsonb)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_relation regclass; v_columns text;
begin
  if p_table not in ('persons','private_profiles','profile_measurements','energy_estimates','target_versions','target_items','target_item_private_inputs',
    'foods','food_versions','food_nutrient_values','food_categories','food_tags','food_synonyms','food_measures',
    'recipes','recipe_versions','recipe_ingredients','recipe_favorites','plans','plan_day_completeness','planned_batches',
    'meal_entries','meal_allocations','plan_changes','prep_reminders','cooking_checklist_items','feedback','plan_drafts',
    'draft_entries','draft_allocations','inventory_items','inventory_movements','shopping_extras','shopping_snapshots',
    'shopping_snapshot_items','shopping_checkoffs','procurement_positions','procurement_receipts','merchant_preferences',
    'merchant_links','legacy_external_ids','legacy_import_issues')
  then perform app_private.fail('IMPORT_SCHEMA'); end if;
  v_relation:=pg_catalog.to_regclass('public.'||pg_catalog.quote_ident(p_table));
  if v_relation is null or exists(
    select 1 from pg_catalog.jsonb_object_keys(p_row) as supplied(key)
    where not exists(
      select 1 from pg_catalog.pg_attribute a
      where a.attrelid=v_relation and a.attnum>0 and not a.attisdropped and a.attname=supplied.key
    )
  ) then perform app_private.fail('IMPORT_SCHEMA'); end if;
  select pg_catalog.string_agg(pg_catalog.quote_ident(a.attname),',' order by a.attnum)
    into v_columns
    from pg_catalog.pg_attribute a
    where a.attrelid=v_relation and a.attnum>0 and not a.attisdropped and p_row ? a.attname;
  if v_columns is null then perform app_private.fail('IMPORT_SCHEMA'); end if;
  execute pg_catalog.format(
    'insert into public.%1$I (%2$s) select %2$s from pg_catalog.jsonb_populate_record(null::public.%1$I,$1)',
    p_table,v_columns
  ) using p_row;
end $$;

create or replace function public.apply_import_data(p_command jsonb)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  p jsonb:=p_command->'payload'; v_replay jsonb; v_household uuid:=(p->>'householdId')::uuid;
  v_preview_id uuid:=(p->>'previewId')::uuid; v_preview public.data_import_previews%rowtype;
  v_source uuid; v_revision integer; v_plan_revision integer; v_inventory_revision integer; v_shopping_revision integer;
  v_token_hash text; v_existing_hash text; v_ids jsonb:='{}'::jsonb; v_map jsonb; v_table text;
  v_row jsonb; v_import_row jsonb; v_source_hash text; v_op uuid:=(p_command->>'operationId')::uuid;
  v_counts jsonb; v_result jsonb; v_id_tables text[]:=array['persons','private_profiles','profile_measurements','energy_estimates','target_versions','target_items','foods','food_versions','food_measures','recipes','recipe_versions','recipe_ingredients','plans','planned_batches','meal_entries','meal_allocations','plan_changes','prep_reminders','feedback','plan_drafts','draft_entries','draft_allocations','inventory_items','inventory_movements','shopping_extras','shopping_snapshots','shopping_snapshot_items','procurement_positions','procurement_receipts','merchant_links','legacy_external_ids','legacy_import_issues'];
  v_insert_order text[]:=array['persons','private_profiles','profile_measurements','energy_estimates','target_versions','target_items','target_item_private_inputs','foods','food_versions','food_nutrient_values','food_categories','food_tags','food_synonyms','food_measures','recipes','recipe_versions','recipe_ingredients','recipe_favorites','plans','plan_day_completeness','planned_batches','meal_entries','meal_allocations','plan_changes','prep_reminders','cooking_checklist_items','feedback','plan_drafts','draft_entries','draft_allocations','inventory_items','inventory_movements','shopping_extras','shopping_snapshots','shopping_snapshot_items','shopping_checkoffs','procurement_positions','procurement_receipts','merchant_preferences','merchant_links','legacy_external_ids','legacy_import_issues'];
begin
  v_replay:=app_private.claim_command('apply_import_data',p_command); if v_replay is not null then return v_replay; end if;
  perform app_private.assert_role(v_household,array['owner','editor']);
  select revision,plan_revision,inventory_revision,shopping_revision
    into v_revision,v_plan_revision,v_inventory_revision,v_shopping_revision
    from public.households where id=v_household for update;
  if not found then perform app_private.fail('NOT_FOUND'); end if;
  perform app_private.assert_revision(p_command,v_household,v_revision);
  select * into v_preview from public.data_import_previews
    where id=v_preview_id and household_id=v_household and user_id=auth.uid() for update;
  if not found or v_preview.expires_at<=now() or v_preview.consumed_at is not null then perform app_private.fail('IMPORT_PREVIEW_EXPIRED'); end if;
  if p->>'previewToken' is null then perform app_private.fail('IMPORT_TOKEN'); end if;
  v_token_hash:=encode(extensions.digest(convert_to(p->>'previewToken','UTF8'),'sha256'),'hex');
  if v_token_hash<>v_preview.token_hash then perform app_private.fail('IMPORT_TOKEN'); end if;
  if encode(extensions.digest(convert_to(v_preview.input_payload::text,'UTF8'),'sha256'),'hex')<>v_preview.input_hash then perform app_private.fail('IMPORT_SCHEMA'); end if;
  if jsonb_typeof(v_preview.report->'conflicts') is distinct from 'array' then perform app_private.fail('IMPORT_SCHEMA'); end if;
  v_source:=(v_preview.input_payload->>'sourceHouseholdId')::uuid;
  v_source_hash:=v_preview.input_hash;
  select source_hash into v_existing_hash from public.data_import_sources
    where target_household_id=v_household and source_household_id=v_source for update;
  if found and v_existing_hash=v_source_hash then
    update public.data_import_previews set consumed_at=now() where id=v_preview_id;
    v_result:=jsonb_build_object('operationId',v_op,'replayed',false,'result',jsonb_build_object('sourceHouseholdId',v_source,'alreadyImported',true,'counts',v_preview.report->'counts'),'revisions',jsonb_build_object(v_household::text,v_revision));
    perform app_private.complete_command(v_op,v_result); return v_result;
  end if;
  if jsonb_array_length(v_preview.report->'conflicts')>0 then perform app_private.fail('IMPORT_CONFLICT'); end if;
  if found then perform app_private.fail('IMPORT_SOURCE_CONFLICT'); end if;
  if jsonb_array_length(v_preview.input_payload->'records'->'merchant_preferences')>0
    and exists(select 1 from public.merchant_preferences where household_id=v_household)
  then perform app_private.fail('IMPORT_CONFLICT'); end if;
  if exists(
    select 1 from jsonb_array_elements(v_preview.input_payload->'records'->'plan_day_completeness') x
    where exists(select 1 from public.plan_day_completeness c where c.household_id=v_household and c.complete_on=(x->>'complete_on')::date)
  ) then perform app_private.fail('IMPORT_CONFLICT'); end if;
  if exists(
    select 1 from jsonb_array_elements(v_preview.input_payload->'records'->'shopping_checkoffs') x
    where exists(select 1 from public.shopping_checkoffs c where c.household_id=v_household and c.line_key=x->>'line_key')
  ) then perform app_private.fail('IMPORT_CONFLICT'); end if;
  for v_table in select unnest(v_id_tables) loop
    select coalesce(jsonb_object_agg(r.value->>'id',to_jsonb(pg_catalog.gen_random_uuid()::text)),'{}'::jsonb)
      into v_map
      from jsonb_array_elements(v_preview.input_payload->'records'->v_table) as r(value)
      where r.value ? 'id';
    v_ids:=v_ids||jsonb_build_object(v_table,v_map);
  end loop;
  v_map:=app_private.portable_import_uuid_maps(v_preview.input_payload->'portableIdentities');
  for v_table in select jsonb_object_keys(v_map) loop
    v_ids:=jsonb_set(v_ids,array[v_table],coalesce(v_ids->v_table,'{}'::jsonb)||(v_map->v_table),true);
  end loop;
  set constraints all deferred;
  foreach v_table in array v_insert_order loop
    if v_table='inventory_movements' then
      for v_row in select value from jsonb_array_elements(v_preview.input_payload->'records'->v_table) where value->>'reversal_of_id' is null loop
        v_import_row:=app_private.prepare_portable_import_row(v_table,v_row,v_household,auth.uid(),v_ids);
        perform app_private.insert_portable_import_row(v_table,v_import_row);
      end loop;
      for v_row in select value from jsonb_array_elements(v_preview.input_payload->'records'->v_table) where value->>'reversal_of_id' is not null loop
        v_import_row:=app_private.prepare_portable_import_row(v_table,v_row,v_household,auth.uid(),v_ids);
        perform app_private.insert_portable_import_row(v_table,v_import_row);
      end loop;
    else
      for v_row in select value from jsonb_array_elements(v_preview.input_payload->'records'->v_table) loop
        v_import_row:=app_private.prepare_portable_import_row(v_table,v_row,v_household,auth.uid(),v_ids);
        perform app_private.insert_portable_import_row(v_table,v_import_row);
      end loop;
    end if;
  end loop;
  insert into public.data_import_sources(target_household_id,source_household_id,source_hash,imported_by)
  values(v_household,v_source,v_source_hash,auth.uid());
  insert into public.export_import_receipts(household_id,operation_id,input_hash,imported_counts,created_by)
  values(v_household,v_op,v_source_hash,v_preview.report->'counts',auth.uid());
  update public.data_import_previews set consumed_at=now() where id=v_preview_id;
  update public.households set revision=revision+1,plan_revision=plan_revision+1,
    inventory_revision=inventory_revision+1,shopping_revision=shopping_revision+1 where id=v_household
    returning revision,plan_revision,inventory_revision,shopping_revision
    into v_revision,v_plan_revision,v_inventory_revision,v_shopping_revision;
  v_counts:=v_preview.report->'counts';
  v_result:=jsonb_build_object('operationId',v_op,'replayed',false,
    'result',jsonb_build_object('sourceHouseholdId',v_source,'alreadyImported',false,'counts',v_counts),
    'revisions',jsonb_build_object(v_household::text,v_revision,'plan:'||v_household::text,v_plan_revision,
      'inventory:'||v_household::text,v_inventory_revision,'shopping:'||v_household::text,v_shopping_revision));
  perform app_private.complete_command(v_op,v_result); return v_result;
end $$;
revoke all on function app_private.portable_referenced_food_version_ids(uuid) from public,anon,authenticated;
revoke all on function app_private.food_version_calculation_provenance(uuid) from public,anon,authenticated;
revoke all on function app_private.export_portable_identities(uuid,uuid) from public,anon,authenticated;
revoke all on function app_private.resolve_portable_identity(jsonb,text,text) from public,anon,authenticated;
revoke all on function app_private.portable_import_uuid_maps(jsonb) from public,anon,authenticated;

revoke all on function app_private.import_map_uuid(jsonb,text,text) from public,anon,authenticated;
revoke all on function app_private.remap_import_field(jsonb,text,text,jsonb) from public,anon,authenticated;
revoke all on function app_private.remap_import_uuid_array(jsonb,text,jsonb) from public,anon,authenticated;
revoke all on function app_private.remap_import_plan_state(jsonb,jsonb) from public,anon,authenticated;
revoke all on function app_private.validate_import_plan_state(jsonb,jsonb,uuid,uuid[]) from public,anon,authenticated;
revoke all on function app_private.validate_import_uuid_array(jsonb,jsonb,text) from public,anon,authenticated;
revoke all on function app_private.prepare_portable_import_row(text,jsonb,uuid,uuid,jsonb) from public,anon,authenticated;
revoke all on function app_private.insert_portable_import_row(text,jsonb) from public,anon,authenticated;
revoke all on function public.export_household_data(uuid,uuid) from public,anon;
revoke all on function public.preview_import_data(jsonb) from public,anon;
revoke all on function public.apply_import_data(jsonb) from public,anon;
grant execute on function public.export_household_data(uuid,uuid) to authenticated;
grant execute on function public.preview_import_data(jsonb) to authenticated;
grant execute on function public.apply_import_data(jsonb) to authenticated;
