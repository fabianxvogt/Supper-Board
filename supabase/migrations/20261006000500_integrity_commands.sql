alter table public.food_versions add column nutrient_basis text not null default 'unknown'
  check (nutrient_basis in ('edible','purchase','drained','unknown'));

-- Post-core constraints and revisioned commands omitted from the initial slice.

alter table public.procurement_receipts
  add column reversed_at timestamptz,
  add column reversed_by uuid references auth.users(id) on delete set null,
  add column reversal_movement_id uuid unique references public.inventory_movements(id) on delete restrict,
  add constraint procurement_receipts_reversal_consistency check ((reversed_at is null) = (reversal_movement_id is null));

alter table public.legacy_external_ids drop constraint legacy_external_ids_entity_type_check;
alter table public.legacy_external_ids add constraint legacy_external_ids_entity_type_check
  check (entity_type in ('person','recipe','recipe_version','ingredient','plan','batch','meal_entry','inventory_item','inventory_movement','feedback','shopping_extra','shopping_snapshot','shopping_snapshot_item','procurement_position','procurement_receipt','draft','draft_entry','reminder'));

create or replace function app_private.prevent_category_cycle()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if new.parent_id is not null and exists (
    with recursive ancestors(id) as (
      select new.parent_id
      union
      select c.parent_id from public.categories c join ancestors a on c.id=a.id where c.parent_id is not null
    ) select 1 from ancestors where id=new.id
  ) then
    raise exception using message='CATEGORY_CYCLE',errcode='23514';
  end if;
  return new;
end $$;
create trigger categories_no_cycle before insert or update of parent_id on public.categories
for each row execute function app_private.prevent_category_cycle();

create or replace function app_private.prevent_published_food_mutation()
returns trigger language plpgsql set search_path = ''
as $$
declare v_release uuid; v_status text;
begin
  if tg_op='DELETE' then v_release:=old.source_release_id; else v_release:=new.source_release_id; end if;
  if v_release is not null then
    select status into v_status from public.source_releases where id=v_release;
    if v_status is distinct from 'staging' then
      raise exception using message='PUBLISHED_FOOD_VERSION_IMMUTABLE',errcode='55000';
    end if;
  elsif tg_op='UPDATE' then
    raise exception using message='HOUSEHOLD_FOOD_VERSION_IMMUTABLE',errcode='55000';
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;
create trigger food_versions_immutable after update or delete on public.food_versions
for each row execute function app_private.prevent_published_food_mutation();

create or replace function app_private.prevent_published_food_child_mutation()
returns trigger language plpgsql set search_path = ''
as $$
declare v_food_version uuid; v_release uuid; v_status text;
begin
  v_food_version:=case when tg_op='DELETE' then old.food_version_id else new.food_version_id end;
  select v.source_release_id into v_release from public.food_versions v where v.id=v_food_version;
  if v_release is not null then
    select status into v_status from public.source_releases where id=v_release;
    if v_status is distinct from 'staging' then
      raise exception using message='PUBLISHED_FOOD_DATA_IMMUTABLE',errcode='55000';
    end if;
  elsif tg_op='UPDATE' then
    raise exception using message='HOUSEHOLD_FOOD_DATA_IMMUTABLE',errcode='55000';
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;
create trigger food_values_immutable before update or delete on public.food_nutrient_values
for each row execute function app_private.prevent_published_food_child_mutation();
create trigger food_categories_immutable before update or delete on public.food_categories
for each row execute function app_private.prevent_published_food_child_mutation();
create trigger food_tags_immutable before update or delete on public.food_tags
for each row execute function app_private.prevent_published_food_child_mutation();
create trigger food_synonyms_immutable before update or delete on public.food_synonyms
for each row execute function app_private.prevent_published_food_child_mutation();
create trigger food_measures_immutable before update or delete on public.food_measures
for each row execute function app_private.prevent_published_food_child_mutation();

create or replace function public.get_shared_person_targets(p_household_id uuid,p_person_id uuid,p_as_of_date date default current_date)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare v_profile uuid; v_version public.target_versions%rowtype; v_next date; v_targets jsonb;
begin
  perform app_private.assert_role(p_household_id,array['owner','editor','viewer']);
  select p.id into v_profile from public.private_profiles p where p.household_id=p_household_id and p.person_id=p_person_id and p.share_targets_with_household;
  if v_profile is null then return null; end if;
  select t.* into v_version from public.target_versions t where t.profile_id=v_profile and t.valid_from<=p_as_of_date order by t.valid_from desc,t.version_number desc limit 1;
  if not found then return null; end if;
  select min(t.valid_from) into v_next from public.target_versions t where t.profile_id=v_profile and t.valid_from>v_version.valid_from;
  select coalesce(jsonb_agg(jsonb_build_object(
    'nutrientId',i.nutrient_code,'unit',i.unit,'type',i.target_kind,'amount',i.point_value::text,
    'minimum',i.minimum::text,'maximum',i.maximum::text,'origin',i.origin,'targetVersionId',v_version.id,
    'referencePackId',i.reference_pack_id,'referenceValueId',i.reference_value_id,'locked',i.manually_locked
  ) order by i.nutrient_code),'[]'::jsonb) into v_targets
  from public.target_items i where i.target_version_id=v_version.id;
  return jsonb_build_object(
    'id',v_version.id,'personId',p_person_id,'revision',v_version.version_number,
    'validFrom',v_version.valid_from,'validThrough',case when v_next is null then null else v_next-1 end,
    'origin',v_version.origin,'isImportedUnverified',v_version.imported_unverified,'targets',v_targets,
    'referencePackVersion',(select rp.version from public.reference_packs rp where rp.id=v_version.reference_pack_id and rp.review_status='approved')
  );
end $$;

create or replace function public.set_shopping_checkoff(p_command jsonb)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  p jsonb:=p_command->'payload'; v_replay jsonb; v_household uuid:=(p->>'householdId')::uuid;
  v_line text:=btrim(p->>'lineKey'); v_fingerprint text:=p->>'lineFingerprint'; v_checked boolean; v_plan integer; v_inventory integer;
  v_shopping integer; v_line_revision integer; v_new_line_revision integer; v_new_shopping integer;
  v_result jsonb; v_op uuid:=(p_command->>'operationId')::uuid;
begin
  v_replay:=app_private.claim_command('set_shopping_checkoff',p_command); if v_replay is not null then return v_replay; end if;
  perform app_private.assert_role(v_household,array['owner','editor']);
  if jsonb_typeof(p->'checked') is distinct from 'boolean' or v_line is null or length(v_line)>500 or v_fingerprint is null or v_fingerprint !~ '^[0-9a-f]{64}$' then perform app_private.fail('VALIDATION'); end if;
  v_checked:=(p->>'checked')::boolean;
  select plan_revision,inventory_revision,shopping_revision into v_plan,v_inventory,v_shopping
  from public.households where id=v_household for update;
  if not found then perform app_private.fail('NOT_FOUND'); end if;
  perform app_private.assert_revision(p_command,v_household,v_shopping);
  if (p->>'sourcePlanRevision')::integer is distinct from v_plan or (p->>'sourceInventoryRevision')::integer is distinct from v_inventory then perform app_private.fail('REVISION_CONFLICT'); end if;
  select revision into v_line_revision from public.shopping_checkoffs where household_id=v_household and line_key=v_line for update;
  if found then v_new_line_revision:=v_line_revision+1; else v_new_line_revision:=1; end if;
  insert into public.shopping_checkoffs(household_id,line_key,source_plan_revision,source_inventory_revision,line_fingerprint,checked,checked_by,checked_at,revision)
  values(v_household,v_line,v_plan,v_inventory,v_fingerprint,v_checked,case when v_checked then auth.uid() else null end,case when v_checked then now() else null end,v_new_line_revision)
  on conflict(household_id,line_key) do update set source_plan_revision=excluded.source_plan_revision,
    source_inventory_revision=excluded.source_inventory_revision,line_fingerprint=excluded.line_fingerprint,checked=excluded.checked,
    checked_by=excluded.checked_by,checked_at=excluded.checked_at,revision=excluded.revision,updated_at=now();
  update public.households set shopping_revision=shopping_revision+1 where id=v_household returning shopping_revision into v_new_shopping;
  v_result:=jsonb_build_object('operationId',v_op,'replayed',false,'result',jsonb_build_object('lineKey',v_line,'lineFingerprint',v_fingerprint,'checked',v_checked,'revision',v_new_line_revision,'sourcePlanRevision',v_plan,'sourceInventoryRevision',v_inventory),'revisions',jsonb_build_object(v_household::text,v_new_shopping,v_line::text,v_new_line_revision));
  perform app_private.complete_command(v_op,v_result); return v_result;
end $$;

create or replace function public.undo_inventory_movement(p_command jsonb)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  p jsonb:=p_command->'payload'; v_replay jsonb; v_household uuid:=(p->>'householdId')::uuid;
  v_movement_id uuid:=(p->>'movementId')::uuid; v_movement public.inventory_movements%rowtype;
  v_item public.inventory_items%rowtype; v_receipt public.procurement_receipts%rowtype;
  v_position public.procurement_positions%rowtype; v_balance numeric; v_delta numeric;
  v_inventory_revision integer; v_item_revision integer; v_position_revision integer;
  v_shopping_revision integer; v_snapshot_revision integer; v_reversal uuid; v_op uuid:=(p_command->>'operationId')::uuid; v_result jsonb;
begin
  v_replay:=app_private.claim_command('undo_inventory_movement',p_command); if v_replay is not null then return v_replay; end if;
  perform app_private.assert_role(v_household,array['owner','editor']);
  select * into v_movement from public.inventory_movements where id=v_movement_id and household_id=v_household for update;
  if not found or v_movement.reversal_of_id is not null then perform app_private.fail('NOT_FOUND'); end if;
  if exists(select 1 from public.inventory_movements r where r.reversal_of_id=v_movement_id) then perform app_private.fail('MOVEMENT_ALREADY_REVERSED'); end if;
  select * into v_item from public.inventory_items where id=v_movement.inventory_item_id and household_id=v_household for update;
  if not found then perform app_private.fail('NOT_FOUND'); end if;
  perform app_private.assert_revision(p_command,v_item.id,v_item.revision);
  if v_item.quantity is null or v_item.status<>'confirmed' or v_item.needs_review then perform app_private.fail('QUANTITY_UNKNOWN'); end if;
  v_balance:=v_item.quantity-v_movement.delta; v_delta:=-v_movement.delta;
  if not public.numeric_is_finite(v_balance) or v_balance<0 then perform app_private.fail('INSUFFICIENT_STOCK'); end if;
  select inventory_revision,shopping_revision into v_inventory_revision,v_shopping_revision from public.households where id=v_household for update;
  if not found then perform app_private.fail('NOT_FOUND'); end if;
  perform app_private.assert_revision(p_command,v_household,v_inventory_revision);
  insert into public.inventory_movements(household_id,inventory_item_id,delta,quantity_after,reversal_of_id,unit,reason,note,actor_user_id,operation_id)
  values(v_household,v_item.id,v_delta,v_balance,v_movement.id,v_item.unit,'correction','Undo inventory movement '||v_movement.id::text,auth.uid(),v_op)
  returning id into v_reversal;
  update public.inventory_items set quantity=v_balance,status='confirmed',needs_review=false,confirmed_at=now(),revision=revision+1
  where id=v_item.id returning revision into v_item_revision;
  update public.inventory_items set confirmed_revision=v_item_revision where id=v_item.id;
  select * into v_receipt from public.procurement_receipts where inventory_movement_id=v_movement.id for update;
  if found then
    if v_receipt.reversed_at is not null then perform app_private.fail('MOVEMENT_ALREADY_REVERSED'); end if;
    select * into v_position from public.procurement_positions where id=v_receipt.position_id and household_id=v_household for update;
    if not found or v_position.received_quantity<v_receipt.quantity then perform app_private.fail('INTEGRITY'); end if;
    update public.procurement_positions set received_quantity=received_quantity-v_receipt.quantity,
      status=case when received_quantity-v_receipt.quantity+cancelled_quantity>=ordered_quantity then case when cancelled_quantity>=ordered_quantity then 'cancelled' else 'received' end
        when received_quantity-v_receipt.quantity>0 then 'partial' else 'ordered' end,
      revision=revision+1 where id=v_position.id returning revision into v_position_revision;
    update public.procurement_receipts set reversed_at=now(),reversed_by=auth.uid(),reversal_movement_id=v_reversal where id=v_receipt.id;
    update public.shopping_snapshots set revision=revision+1 where id=v_position.snapshot_id returning revision into v_snapshot_revision;
  end if;
  update public.households set inventory_revision=inventory_revision+1,shopping_revision=shopping_revision+case when v_receipt.id is null then 0 else 1 end
  where id=v_household returning inventory_revision,shopping_revision into v_inventory_revision,v_shopping_revision;
  v_result:=jsonb_build_object('operationId',v_op,'replayed',false,'result',jsonb_build_object('movementId',v_movement.id,'reversalMovementId',v_reversal,'itemId',v_item.id,'balance',v_balance::text,'receiptReversed',v_receipt.id is not null),'revisions',jsonb_build_object(v_item.id::text,v_item_revision,v_household::text,v_inventory_revision));
  if v_position.id is not null then v_result:=jsonb_set(v_result,'{revisions}',(v_result->'revisions')||jsonb_build_object(v_position.id::text,v_position_revision,v_receipt.id::text,1,v_position.snapshot_id::text,v_snapshot_revision)); end if;
  perform app_private.complete_command(v_op,v_result); return v_result;
end $$;

-- Custom foods may only store canonical units, and one value per nutrient.
create or replace function public.create_household_food(p_command jsonb)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare p jsonb:=p_command->'payload'; v_replay jsonb; v_household uuid:=(p->>'householdId')::uuid; v_food uuid; v_version uuid; v_op uuid:=(p_command->>'operationId')::uuid; v_n jsonb; v_nutrient uuid; v_code text; v_unit text; v_input_unit text; v_amount numeric; v_component text; v_result jsonb; v_seen uuid[]:='{}'; v_basis text:=p->>'nutrientBasis';
begin
  v_replay:=app_private.claim_command('create_household_food',p_command); if v_replay is not null then return v_replay; end if;
  perform app_private.assert_role(v_household,array['owner','editor']); perform app_private.assert_new_revision(p_command);
  if nullif(btrim(p->>'nameDe'),'') is null or length(btrim(p->>'nameDe'))>200 or v_basis is null or v_basis not in ('edible','purchase','drained','unknown') or jsonb_typeof(coalesce(p->'nutrients','[]'::jsonb))<>'array' or jsonb_typeof(coalesce(p->'categoryIds','[]'::jsonb))<>'array' then perform app_private.fail('VALIDATION'); end if;
  insert into public.foods(source_id,source_food_code,owner_household_id,created_by_user_id,compatibility_key)
  values(null,null,v_household,auth.uid(),nullif(p->>'compatibilityKey','')) returning id into v_food;
  insert into public.food_versions(food_id,source_release_id,version_number,name_de,name_en,preparation_state,source_notes,nutrient_basis)
  values(v_food,null,1,btrim(p->>'nameDe'),nullif(p->>'nameEn',''),nullif(p->>'preparationState',''),nullif(p->>'sourceNotes',''),v_basis) returning id into v_version;
  for v_n in select value from jsonb_array_elements(coalesce(p->'nutrients','[]'::jsonb)) loop
    select id,code,unit into v_nutrient,v_code,v_unit from public.nutrient_definitions where id::text=v_n->>'nutrientId' or code=v_n->>'nutrientId' order by (id::text=v_n->>'nutrientId') desc limit 1;
    if v_nutrient is null then perform app_private.fail('UNKNOWN_NUTRIENT'); end if;
    if v_nutrient=any(v_seen) then perform app_private.fail('DUPLICATE_NUTRIENT'); end if;
    v_seen:=array_append(v_seen,v_nutrient); v_input_unit:=v_n->>'unit';
    if v_input_unit is distinct from v_unit then perform app_private.fail('UNIT_MISMATCH'); end if;
    begin v_amount:=(v_n->>'amount')::numeric; exception when others then perform app_private.fail('VALIDATION'); end;
    if v_amount is null or not public.numeric_is_finite(v_amount) or v_amount<0 then perform app_private.fail('VALIDATION'); end if;
    v_component:='USER:'||v_code;
    insert into public.food_nutrient_values(food_version_id,source_component_code,nutrient_definition_id,raw_value,normalized_amount,unit,value_status,source_method,source_reference,mapping_version)
    values(v_version,v_component,v_nutrient,v_amount::text,v_amount,v_unit,case when v_amount=0 then 'explicit_zero' else 'numeric' end,'user-entered',nullif(v_n->>'sourceReference',''),'user-entered-v1');
  end loop;
  insert into public.food_categories(food_version_id,category_id,is_primary)
  select v_version,x.value::uuid,ordinality=1 from jsonb_array_elements_text(coalesce(p->'categoryIds','[]'::jsonb)) with ordinality x(value,ordinality);
  v_result:=jsonb_build_object('operationId',v_op,'replayed',false,'result',jsonb_build_object('foodId',v_food,'foodVersionId',v_version,'nameDe',btrim(p->>'nameDe')),'revisions',jsonb_build_object());
  perform app_private.complete_command(v_op,v_result); return v_result;
end $$;

create or replace function public.search_food_catalog(
  p_query text,
  p_household_id uuid,
  p_category_id uuid,
  p_tags text[],
  p_release_id uuid,
  p_include_household_foods boolean,
  p_offset integer,
  p_limit integer
)
returns jsonb language plpgsql stable security invoker set search_path = ''
as $$
declare
  v_query text:=nullif(btrim(p_query),'');
  v_escaped text;
  v_tags text[]:=coalesce(p_tags,'{}'::text[]);
  v_rows jsonb;
  v_items jsonb;
  v_active uuid;
begin
  if length(v_query)>200 or coalesce(p_offset,-1)<0 or p_offset>100000 or coalesce(p_limit,0)<1 or p_limit>100
    or cardinality(v_tags)>20 or exists(select 1 from unnest(v_tags) t where length(btrim(t)) not between 1 and 80)
  then raise exception using message='VALIDATION',errcode='P0001'; end if;
  v_escaped:=replace(v_query,E'\\',E'\\\\');
  v_escaped:=replace(v_escaped,'%',E'\\%');
  v_escaped:=replace(v_escaped,'_',E'\\_');
  select r.id into v_active from public.source_releases r where r.status='active' order by r.imported_at desc,r.id limit 1;
  select coalesce(jsonb_agg(q.item order by q.name_de,q.id),'[]'::jsonb) into v_rows
  from (
    select v.name_de,v.id,
      jsonb_build_object('id',v.id,'food_id',v.food_id,'name_de',v.name_de,'name_en',v.name_en,
        'preparation_state',v.preparation_state,'source_release_id',v.source_release_id,'nutrient_basis',v.nutrient_basis,
        'foods',jsonb_build_object('id',f.id,'source_id',f.source_id,'source_food_code',f.source_food_code,
          'owner_household_id',f.owner_household_id,'owner_user_id',f.owner_user_id,'compatibility_key',f.compatibility_key)) as item
    from public.food_versions v join public.foods f on f.id=v.food_id
    where (f.source_id is not null and exists(select 1 from public.source_releases r where r.id=v.source_release_id and r.status='active')
       or p_household_id is not null and p_include_household_foods is true
          and f.owner_household_id=p_household_id and public.has_household_role(p_household_id,array['owner','editor','viewer'])
       or f.owner_user_id=auth.uid())
      and (p_release_id is null or v.source_release_id=p_release_id)
      and (p_category_id is null or exists(select 1 from public.food_categories c where c.food_version_id=v.id and c.category_id=p_category_id))
      and (cardinality(v_tags)=0 or not exists(
        select tag from unnest(v_tags) requested(tag)
        except select ft.tag from public.food_tags ft where ft.food_version_id=v.id
      ))
      and (v_query is null or v.name_de ilike '%'||v_escaped||'%' escape E'\\'
        or coalesce(v.name_en,'') ilike '%'||v_escaped||'%' escape E'\\'
        or exists(select 1 from public.food_synonyms s where s.food_version_id=v.id and s.synonym ilike '%'||v_escaped||'%' escape E'\\'))
    order by v.name_de,v.id
    offset p_offset limit p_limit+1
  ) q;
  select coalesce(jsonb_agg(value order by ordinality),'[]'::jsonb)
  into v_items from jsonb_array_elements(v_rows) with ordinality e(value,ordinality) where ordinality<=p_limit;
  return jsonb_build_object('items',v_items,'hasMore',jsonb_array_length(v_rows)>p_limit,'activeReleaseId',v_active);
end $$;

create or replace function public.preview_plan_move(
  p_household_id uuid,
  p_plan_id uuid,
  p_entry_ids uuid[],
  p_days integer,
  p_scope text,
  p_expected_revision integer
)
returns jsonb language plpgsql stable security invoker set search_path = ''
as $$
declare
  v_plan_revision integer;
  v_min_date date;
  v_given integer;
  v_affected_ids uuid[];
  v_batch_ids uuid[];
  v_affected jsonb;
  v_dependent jsonb;
  v_reminders jsonb;
  v_conflicts jsonb;
begin
  if not public.has_household_role(p_household_id,array['owner','editor']) then
    raise exception using message=case when auth.uid() is null then 'AUTH_REQUIRED' else 'FORBIDDEN' end,errcode='P0001';
  end if;
  if p_days is null or p_days=0 or p_days not between -365 and 365 or p_scope not in ('selected','following')
     or coalesce(cardinality(p_entry_ids),0)=0 or cardinality(p_entry_ids)>1000
  then raise exception using message='VALIDATION',errcode='P0001'; end if;
  select revision into v_plan_revision from public.plans
  where id=p_plan_id and household_id=p_household_id and status='active';
  if not found then raise exception using message='NOT_FOUND',errcode='P0001'; end if;
  if p_expected_revision is null then raise exception using message='REVISION_REQUIRED',errcode='P0001'; end if;
  if p_expected_revision<>v_plan_revision then raise exception using message='REVISION_CONFLICT',errcode='P0001'; end if;
  select min(entry_date),count(*) into v_min_date,v_given from public.meal_entries
  where id=any(p_entry_ids) and household_id=p_household_id and plan_id=p_plan_id and archived_at is null;
  if v_given<>cardinality(p_entry_ids) then raise exception using message='FOREIGN_ID',errcode='P0001'; end if;
  if p_scope='following' then
    select array_agg(id order by entry_date,slot,id) into v_affected_ids from public.meal_entries
    where household_id=p_household_id and plan_id=p_plan_id and archived_at is null and entry_date>=v_min_date;
  else
    v_affected_ids:=p_entry_ids;
  end if;
  select coalesce(array_agg(distinct b.id order by b.id),'{}'::uuid[]) into v_batch_ids
  from public.meal_entries e join public.planned_batches b on b.id=e.batch_id
  where e.id=any(v_affected_ids) and e.household_id=p_household_id and e.plan_id=p_plan_id
    and e.archived_at is null and e.entry_date=b.cook_date;
  select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'date',(e.entry_date+p_days)::text,
    'label',coalesce(e.label,rv.title,fv.name_de,''),'slot',e.slot) order by e.entry_date+p_days,e.slot,e.id),'[]'::jsonb)
  into v_affected
  from public.meal_entries e
  left join public.planned_batches b on b.id=e.batch_id
  left join public.recipe_versions rv on rv.id=b.recipe_version_id
  left join public.food_versions fv on fv.id=e.food_version_id
  where e.id=any(v_affected_ids) and e.household_id=p_household_id and e.plan_id=p_plan_id and e.archived_at is null;
  select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'date',e.entry_date::text,
    'label',coalesce(e.label,rv.title,fv.name_de,''),'slot',e.slot) order by e.entry_date,e.slot,e.id),'[]'::jsonb)
  into v_dependent
  from public.meal_entries e
  left join public.planned_batches b on b.id=e.batch_id
  left join public.recipe_versions rv on rv.id=b.recipe_version_id
  left join public.food_versions fv on fv.id=e.food_version_id
  where e.household_id=p_household_id and e.plan_id=p_plan_id and e.archived_at is null
    and b.id=any(v_batch_ids) and not (e.id=any(v_affected_ids));
  select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'originalDate',r.reminder_date::text,
    'proposedDate',(r.reminder_date+p_days)::text,'entryId',r.entry_id,'batchId',r.batch_id,'text',r.text)
    order by r.reminder_date,r.id),'[]'::jsonb)
  into v_reminders
  from public.prep_reminders r
  where r.household_id=p_household_id and (r.entry_id=any(v_affected_ids) or r.batch_id=any(v_batch_ids));
  select coalesce(jsonb_agg('REST_BEFORE_COOK:'||e.id::text||':'||
    (e.entry_date+case when e.id=any(v_affected_ids) then p_days else 0 end)::text||':'||
    (b.cook_date+case when b.id=any(v_batch_ids) then p_days else 0 end)::text
    order by e.entry_date,e.id),'[]'::jsonb)
  into v_conflicts
  from public.meal_entries e join public.planned_batches b on b.id=e.batch_id
  where e.household_id=p_household_id and e.plan_id=p_plan_id and e.archived_at is null
    and e.entry_date+case when e.id=any(v_affected_ids) then p_days else 0 end
      < b.cook_date+case when b.id=any(v_batch_ids) then p_days else 0 end;
  return jsonb_build_object('planRevision',v_plan_revision,'affectedEntries',v_affected,
    'dependentEntries',v_dependent,'dependentReminders',v_reminders,'conflicts',v_conflicts);
end $$;

create or replace function app_private.prevent_release_mutation()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if old.status<>'staging' and (
    new.source_id is distinct from old.source_id or new.release_code is distinct from old.release_code
    or new.source_sha256 is distinct from old.source_sha256 or new.source_url is distinct from old.source_url
    or new.published_at is distinct from old.published_at or new.import_report is distinct from old.import_report
  ) then raise exception using message='PUBLISHED_RELEASE_IMMUTABLE',errcode='55000'; end if;
  if old.status='validated' and new.status not in ('validated','active','rejected')
    or old.status='active' and new.status not in ('active','superseded')
    or old.status in ('superseded','rejected') and new.status is distinct from old.status
    or old.status='staging' and new.status not in ('staging','validated','rejected')
  then raise exception using message='INVALID_RELEASE_TRANSITION',errcode='55000'; end if;
  return new;
end $$;
create trigger source_releases_immutable before update on public.source_releases
for each row execute function app_private.prevent_release_mutation();

create or replace function app_private.prevent_target_history_mutation()
returns trigger language plpgsql set search_path = ''
as $$ begin raise exception using message='TARGET_VERSION_IMMUTABLE',errcode='55000'; end $$;
create trigger target_versions_immutable before update on public.target_versions for each row execute function app_private.prevent_target_history_mutation();
create trigger target_items_immutable before update on public.target_items for each row execute function app_private.prevent_target_history_mutation();
create trigger target_item_private_inputs_immutable before update on public.target_item_private_inputs for each row execute function app_private.prevent_target_history_mutation();
create or replace function app_private.prevent_reference_value_mutation()
returns trigger language plpgsql set search_path = ''
as $$ begin raise exception using message='REFERENCE_VALUE_IMMUTABLE',errcode='55000'; end $$;
create trigger reference_values_immutable before update or delete on public.reference_values for each row execute function app_private.prevent_reference_value_mutation();

create or replace function public.delete_private_profile(p_command jsonb)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  p jsonb:=p_command->'payload'; v_replay jsonb; v_profile uuid:=(p->>'profileId')::uuid;
  v_revision integer; v_op uuid:=(p_command->>'operationId')::uuid;
begin
  v_replay:=app_private.claim_command('delete_private_profile',p_command); if v_replay is not null then return v_replay; end if;
  select revision into v_revision from public.private_profiles where id=v_profile and owner_user_id=auth.uid() for update;
  if not found then perform app_private.fail('NOT_FOUND'); end if;
  perform app_private.assert_revision(p_command,v_profile,v_revision);
  delete from public.private_profiles where id=v_profile and owner_user_id=auth.uid();
  perform app_private.complete_command(v_op,jsonb_build_object('operationId',v_op,'replayed',false,'result',jsonb_build_object('profileId',v_profile),'revisions',jsonb_build_object()));
  return (select result from public.operation_receipts where user_id=auth.uid() and operation_id=v_op);
end $$;


create or replace function public.search_household_recipes(
  p_household_id uuid,p_query text,p_favorites_only boolean,p_offset integer,p_limit integer
)
returns jsonb language plpgsql stable security invoker set search_path = ''
as $$
declare v_query text:=nullif(btrim(p_query),''); v_escaped text; v_rows jsonb; v_items jsonb;
begin
  if auth.uid() is null then raise exception using message='AUTH_REQUIRED',errcode='P0001'; end if;
  if not public.has_household_role(p_household_id,array['owner','editor','viewer']) then raise exception using message='FORBIDDEN',errcode='P0001'; end if;
  if length(v_query)>200 or p_offset is null or p_offset<0 or p_offset>100000 or p_limit is null or p_limit<1 or p_limit>100 then
    raise exception using message='VALIDATION',errcode='P0001';
  end if;
  v_escaped:=replace(v_query,E'\\',E'\\\\');
  v_escaped:=replace(v_escaped,'%',E'\\%');
  v_escaped:=replace(v_escaped,'_',E'\\_');
  select coalesce(jsonb_agg(q.item order by q.title,q.recipe_id),'[]'::jsonb) into v_rows
  from (
    select r.title,r.id recipe_id,jsonb_build_object(
      'id',v.id,'recipeId',r.id,'householdId',r.household_id,'title',r.title,
      'description',v.description,'currentVersionId',v.id,'versionNumber',v.version_number,
      'revision',r.revision,'baseServings',v.base_servings::text,'updatedAt',r.updated_at,
      'isFavorite',coalesce(f.is_favorite,false),'favoriteRevision',f.revision
    ) item
    from public.recipes r
    join public.recipe_versions v on v.id=r.current_version_id and v.recipe_id=r.id and v.household_id=r.household_id
    left join public.recipe_favorites f on f.household_id=r.household_id and f.recipe_version_id=v.id and f.user_id=auth.uid()
    where r.household_id=p_household_id and r.archived_at is null
      and (v_query is null or r.title ilike '%'||v_escaped||'%' escape E'\\')
      and (not coalesce(p_favorites_only,false) or f.is_favorite is true)
    order by r.title,r.id offset p_offset limit p_limit+1
  ) q;
  select coalesce(jsonb_agg(value order by ordinality),'[]'::jsonb) into v_items
  from jsonb_array_elements(v_rows) with ordinality e(value,ordinality) where ordinality<=p_limit;
  return jsonb_build_object('items',v_items,'hasMore',jsonb_array_length(v_rows)>p_limit);
end $$;

-- Recipe versions are immutable snapshots; source quantity metadata must be explicit.
create or replace function app_private.prevent_recipe_version_mutation()
returns trigger language plpgsql set search_path = ''
as $$ begin raise exception using message='RECIPE_VERSION_IMMUTABLE',errcode='55000'; end $$;
create trigger recipe_versions_immutable before update on public.recipe_versions for each row execute function app_private.prevent_recipe_version_mutation();
create trigger recipe_ingredients_immutable before update on public.recipe_ingredients for each row execute function app_private.prevent_recipe_version_mutation();

revoke execute on all functions in schema public from public,anon,authenticated;
grant execute on function public.has_household_role(uuid,text[]),public.is_profile_owner(uuid),public.can_read_shared_targets(uuid),public.can_read_target_version(uuid),public.can_read_food(uuid) to anon,authenticated;
grant execute on function public.create_household_with_owner_person(jsonb),public.save_household(jsonb),public.create_person(jsonb),public.create_invitation(jsonb),public.accept_invitation(jsonb),public.change_member_role(jsonb),public.remove_member(jsonb),public.delete_person(jsonb),public.delete_private_profile(jsonb),public.delete_household(jsonb),public.save_private_profile(jsonb),public.save_target_version(jsonb),public.create_household_food(jsonb),public.save_recipe_version(jsonb),public.set_recipe_favorite(jsonb) to authenticated;
grant execute on function public.schedule_batch(jsonb),public.allocate_meal(jsonb),public.schedule_direct_food(jsonb),public.swap_meals(jsonb),public.move_plan(jsonb),public.undo_plan_change(jsonb),public.create_draft(jsonb),public.replace_draft_entry(jsonb),public.approve_draft(jsonb),public.set_checklist_item(jsonb),public.set_plan_day_completeness(jsonb),public.set_prep_reminder(jsonb),public.mark_batch_cooked(jsonb),public.mark_direct_food_provided(jsonb),public.save_feedback(jsonb) to authenticated;
grant execute on function public.save_inventory_status(jsonb),public.record_inventory_movement(jsonb),public.create_shopping_extra(jsonb),public.create_shopping_snapshot(jsonb),public.mark_snapshot_ordered(jsonb),public.confirm_received_items(jsonb),public.cancel_procurement(jsonb),public.save_merchant_preference(jsonb),public.set_shopping_checkoff(jsonb),public.undo_inventory_movement(jsonb),public.get_shared_person_targets(uuid,uuid,date) to authenticated;
grant execute on function public.search_food_catalog(text,uuid,uuid,text[],uuid,boolean,integer,integer) to anon,authenticated;
grant execute on function public.preview_plan_move(uuid,uuid,uuid[],integer,text,integer) to authenticated;
grant execute on function public.search_household_recipes(uuid,text,boolean,integer,integer) to authenticated;
revoke all on all functions in schema app_private from public,anon,authenticated;
