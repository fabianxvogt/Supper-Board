-- Forward-only trust lifecycle repair. Household locks serialize invitation
-- issuance/acceptance with revocation; revoked capabilities never reactivate.
alter table public.household_invitations add column revoked_at timestamptz;
create index household_invitations_issuer_open_idx
  on public.household_invitations(household_id,invited_by)
  where accepted_at is null and revoked_at is null;

-- Existing tokens whose issuer no longer has invitation authority are obsolete.
update public.household_invitations i set revoked_at=now()
where i.accepted_at is null and i.revoked_at is null
  and not exists(select 1 from public.household_members m
    where m.household_id=i.household_id and m.user_id=i.invited_by and m.role in ('owner','editor'));

create or replace function public.create_invitation(p_command jsonb)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_replay jsonb; p jsonb:=p_command->'payload'; v_household uuid:=(p->>'householdId')::uuid;
  v_role text:=coalesce(p->>'role','viewer'); v_email text:=nullif(lower(btrim(p->>'email')),'');
  v_token text; v_invite uuid; v_op uuid:=(p_command->>'operationId')::uuid;
  v_exp timestamptz; v_result jsonb;
begin
  perform 1 from public.households where id=v_household for update;
  if not found then perform app_private.fail('NOT_FOUND'); end if;
  perform app_private.assert_role(v_household,array['owner','editor']);
  v_replay:=app_private.claim_command('create_invitation',p_command);
  if v_replay is not null then
    if not exists(select 1 from public.household_invitations
      where id=(v_replay->'result'->>'invitationId')::uuid and invited_by=auth.uid()
        and revoked_at is null and expires_at>clock_timestamp())
    then perform app_private.fail('INVITATION_INVALID'); end if;
    return v_replay;
  end if;
  perform app_private.assert_new_revision(p_command);
  if v_role not in ('editor','viewer') then perform app_private.fail('VALIDATION'); end if;
  v_token:=encode(extensions.gen_random_bytes(32),'hex');
  if length(v_token)<>64 then perform app_private.fail('CRYPTO_ERROR'); end if;
  v_exp:=now()+make_interval(hours=>greatest(1,least(coalesce((p->>'expiresInHours')::integer,72),168)));
  insert into public.household_invitations(household_id,invited_email,role,token_hash,invited_by,expires_at)
  values(v_household,v_email,v_role,encode(extensions.digest(convert_to(v_token,'UTF8'),'sha256'),'hex'),auth.uid(),v_exp)
  returning id into v_invite;
  v_result:=jsonb_build_object('operationId',v_op,'replayed',false,'result',
    jsonb_build_object('invitationId',v_invite,'token',v_token,'expiresAt',v_exp),'revisions',jsonb_build_object());
  perform app_private.complete_command(v_op,v_result); return v_result;
end $$;

create or replace function public.accept_invitation(p_command jsonb)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_replay jsonb; p jsonb:=p_command->'payload'; v_hash text;
  v_user uuid:=auth.uid(); v_email text; v_household uuid;
  v_inv public.household_invitations%rowtype; v_person uuid; v_name text;
  v_op uuid:=(p_command->>'operationId')::uuid; v_result jsonb;
begin
  if v_user is null then perform app_private.fail('AUTH_REQUIRED'); end if;
  v_hash:=encode(extensions.digest(convert_to(p->>'token','UTF8'),'sha256'),'hex');
  select household_id into v_household from public.household_invitations where token_hash=v_hash;
  if not found then perform app_private.fail('INVITATION_INVALID'); end if;
  -- Always household before invitation: remove/change/creation use this order.
  perform 1 from public.households where id=v_household for update;
  if not found then perform app_private.fail('INVITATION_INVALID'); end if;
  select * into v_inv from public.household_invitations where token_hash=v_hash for update;
  if not found or v_inv.revoked_at is not null
    or not exists(select 1 from public.household_members
      where household_id=v_household and user_id=v_inv.invited_by and role in ('owner','editor'))
  then perform app_private.fail('INVITATION_INVALID'); end if;
  v_replay:=app_private.claim_command('accept_invitation',p_command);
  if v_replay is not null then
    if v_inv.accepted_by is distinct from v_user or not exists(
      select 1 from public.household_members
      where household_id=v_household and user_id=v_user and role=v_inv.role)
    then perform app_private.fail('INVITATION_INVALID'); end if;
    return v_replay;
  end if;
  if v_inv.accepted_at is not null or v_inv.expires_at<=clock_timestamp()
  then perform app_private.fail('INVITATION_INVALID'); end if;
  select lower(email) into v_email from auth.users where id=v_user;
  if v_inv.invited_email is not null and v_inv.invited_email<>v_email
  then perform app_private.fail('INVITATION_EMAIL_MISMATCH'); end if;
  if exists(select 1 from public.household_members where household_id=v_household and user_id=v_user)
  then perform app_private.fail('ALREADY_MEMBER'); end if;
  insert into public.household_members(household_id,user_id,role) values(v_household,v_user,v_inv.role);
  v_name:=coalesce(nullif(btrim(p->>'displayName'),''),split_part(coalesce(v_email,'Household member'),'@',1));
  select id into v_person from public.persons where household_id=v_household and linked_user_id=v_user for update;
  if not found then
    insert into public.persons(household_id,display_name,linked_user_id,nutrition_mode)
    values(v_household,v_name,v_user,'view') returning id into v_person;
  end if;
  update public.household_invitations set accepted_at=now(),accepted_by=v_user where id=v_inv.id;
  v_result:=jsonb_build_object('operationId',v_op,'replayed',false,'result',
    jsonb_build_object('householdId',v_household,'personId',v_person,'role',v_inv.role),
    'revisions',jsonb_build_object(v_household::text,(select revision from public.households where id=v_household)));
  perform app_private.complete_command(v_op,v_result); return v_result;
end $$;

create or replace function public.change_member_role(p_command jsonb)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_replay jsonb; p jsonb:=p_command->'payload'; v_household uuid:=(p->>'householdId')::uuid;
  v_user uuid:=(p->>'userId')::uuid; v_role text:=p->>'role'; v_old_role text;
  v_op uuid:=(p_command->>'operationId')::uuid; v_revision integer; v_count integer; v_result jsonb;
begin
  select revision into v_revision from public.households where id=v_household for update;
  if not found then perform app_private.fail('NOT_FOUND'); end if;
  perform app_private.assert_role(v_household,array['owner']);
  v_replay:=app_private.claim_command('change_member_role',p_command); if v_replay is not null then return v_replay; end if;
  perform app_private.assert_revision(p_command,v_household,v_revision);
  select role into v_old_role from public.household_members where household_id=v_household and user_id=v_user;
  if not found or v_role is null or v_role not in ('owner','editor','viewer') then perform app_private.fail('NOT_FOUND'); end if;
  if v_old_role='owner' and v_role<>'owner' then
    select count(*) into v_count from public.household_members where household_id=v_household and role='owner';
    if v_count<=1 then perform app_private.fail('LAST_OWNER'); end if;
  end if;
  if (v_old_role='owner' and v_role<>'owner') or (v_old_role='editor' and v_role='viewer') then
    update public.household_invitations set revoked_at=now()
    where household_id=v_household and invited_by=v_user and accepted_at is null and revoked_at is null;
  end if;
  update public.household_members set role=v_role where household_id=v_household and user_id=v_user;
  update public.households set revision=revision+1 where id=v_household returning revision into v_revision;
  v_result:=jsonb_build_object('operationId',v_op,'replayed',false,'result',jsonb_build_object('userId',v_user,'role',v_role),
    'revisions',jsonb_build_object(v_household::text,v_revision));
  perform app_private.complete_command(v_op,v_result); return v_result;
end $$;

create or replace function public.remove_member(p_command jsonb)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_replay jsonb; p jsonb:=p_command->'payload'; v_household uuid:=(p->>'householdId')::uuid;
  v_user uuid:=(p->>'userId')::uuid; v_op uuid:=(p_command->>'operationId')::uuid;
  v_revision integer; v_count integer; v_result jsonb;
begin
  select revision into v_revision from public.households where id=v_household for update;
  if not found then perform app_private.fail('NOT_FOUND'); end if;
  perform app_private.assert_role(v_household,array['owner']);
  v_replay:=app_private.claim_command('remove_member',p_command); if v_replay is not null then return v_replay; end if;
  perform app_private.assert_revision(p_command,v_household,v_revision);
  if not exists(select 1 from public.household_members where household_id=v_household and user_id=v_user)
  then perform app_private.fail('NOT_FOUND'); end if;
  if exists(select 1 from public.household_members where household_id=v_household and user_id=v_user and role='owner') then
    select count(*) into v_count from public.household_members where household_id=v_household and role='owner';
    if v_count<=1 then perform app_private.fail('LAST_OWNER'); end if;
  end if;
  update public.household_invitations set revoked_at=now()
  where household_id=v_household and invited_by=v_user and accepted_at is null and revoked_at is null;
  delete from public.household_members where household_id=v_household and user_id=v_user;
  update public.households set revision=revision+1 where id=v_household returning revision into v_revision;
  v_result:=jsonb_build_object('operationId',v_op,'replayed',false,'result',jsonb_build_object('removedUserId',v_user),
    'revisions',jsonb_build_object(v_household::text,v_revision));
  perform app_private.complete_command(v_op,v_result); return v_result;
end $$;

-- Serialize the three private-preview commands per Auth user, across destination
-- households, before any receipt/household/profile/preview lock is acquired.
create or replace function app_private.claim_command(p_action text,p_command jsonb)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_user uuid:=auth.uid(); v_operation uuid; v_payload jsonb; v_hash text;
  v_prior public.operation_receipts%rowtype; v_rows integer;
begin
  if v_user is null then perform app_private.fail('AUTH_REQUIRED'); end if;
  if p_action in ('preview_import_data','apply_import_data','delete_private_profile') then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('supper-board-private-preview:'||v_user::text,0));
  end if;
  if jsonb_typeof(p_command)<>'object' or jsonb_typeof(p_command->'payload')<>'object'
    or jsonb_typeof(p_command->'expectedRevisions')<>'object' then perform app_private.fail('VALIDATION'); end if;
  begin v_operation:=(p_command->>'operationId')::uuid; exception when others then perform app_private.fail('VALIDATION'); end;
  v_payload:=p_command->'payload';
  v_hash:=encode(extensions.digest(convert_to(p_action||':'||v_payload::text,'UTF8'),'sha256'),'hex');
  insert into public.operation_receipts(user_id,operation_id,action,payload_hash)
  values(v_user,v_operation,p_action,v_hash) on conflict(user_id,operation_id) do nothing;
  get diagnostics v_rows=row_count;
  if v_rows=0 then
    select * into v_prior from public.operation_receipts where user_id=v_user and operation_id=v_operation for update;
    if v_prior.action<>p_action or v_prior.payload_hash<>v_hash then perform app_private.fail('IDEMPOTENCY_CONFLICT'); end if;
    if v_prior.result is null then perform app_private.fail('COMMAND_IN_PROGRESS'); end if;
    return v_prior.result||jsonb_build_object('replayed',true);
  end if;
  return null;
end $$;

-- Only identity metadata is retained to attribute source-UUID pending copies to
-- a remapped imported profile. Never infer identity from equal body attributes.
create table app_private.private_profile_import_origins (
  profile_id uuid primary key references public.private_profiles(id) on delete cascade,
  source_household_id uuid not null,
  source_profile_id uuid not null
);
revoke all on app_private.private_profile_import_origins from public,anon,authenticated;
create index data_import_previews_user_idx on public.data_import_previews(user_id);
create index data_import_previews_expiry_idx on public.data_import_previews(expires_at);

create or replace function app_private.dispose_consumed_import_payload()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if new.consumed_at is not null then new.input_payload:='{}'::jsonb; end if;
  return new;
end $$;
create trigger data_import_previews_dispose_consumed
before insert or update on public.data_import_previews
for each row execute function app_private.dispose_consumed_import_payload();

-- All old consumed payloads are safely disposable, regardless of whether an old
-- random import UUID map can still be attributed. Expired tokens cannot apply.
update public.data_import_previews set input_payload='{}'::jsonb
where consumed_at is not null and input_payload<>'{}'::jsonb;
delete from public.data_import_previews where expires_at<=clock_timestamp();
alter table public.data_import_previews add constraint consumed_import_payload_disposed
  check(consumed_at is null or input_payload='{}'::jsonb);
drop policy data_import_previews_owner_read on public.data_import_previews;
create policy data_import_previews_owner_read on public.data_import_previews
for select to authenticated using (
  user_id=auth.uid() and expires_at>clock_timestamp()
  and public.has_household_role(household_id,array['owner','editor'])
);

create or replace function public.delete_private_profile(p_command jsonb)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  p jsonb:=p_command->'payload'; v_replay jsonb; v_profile uuid:=(p->>'profileId')::uuid;
  v_revision integer; v_household uuid; v_origin app_private.private_profile_import_origins%rowtype;
  v_op uuid:=(p_command->>'operationId')::uuid;
begin
  v_replay:=app_private.claim_command('delete_private_profile',p_command); if v_replay is not null then return v_replay; end if;
  select revision,household_id into v_revision,v_household
  from public.private_profiles where id=v_profile and owner_user_id=auth.uid() for update;
  if not found then perform app_private.fail('NOT_FOUND'); end if;
  perform app_private.assert_revision(p_command,v_profile,v_revision);
  select * into v_origin from app_private.private_profile_import_origins where profile_id=v_profile;
  -- A validated export has at most one private profile; deleting its entire
  -- preview invalidates the token and erases all dependent frozen body copies.
  -- Restrict to this user's uploads and exact source household/profile identity.
  delete from public.data_import_previews d
  where d.user_id=auth.uid() and (
    (d.input_payload->>'sourceHouseholdId'=v_household::text
      and d.input_payload->'records'->'private_profiles' @> jsonb_build_array(jsonb_build_object('id',v_profile::text)))
    or (d.input_payload->>'sourceHouseholdId'=v_origin.source_household_id::text
      and d.input_payload->'records'->'private_profiles' @> jsonb_build_array(jsonb_build_object('id',v_origin.source_profile_id::text)))
  );
  delete from public.private_profiles where id=v_profile and owner_user_id=auth.uid();
  perform app_private.complete_command(v_op,jsonb_build_object('operationId',v_op,'replayed',false,
    'result',jsonb_build_object('profileId',v_profile),'revisions',jsonb_build_object()));
  return (select result from public.operation_receipts where user_id=auth.uid() and operation_id=v_op);
end $$;

-- Keep the existing importer and UUID remapping contract. The only changes are
-- locked current authorization, wall-clock expiry, and private source identity
-- recording. The consumption trigger disposes payloads on both success paths.
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
  v_replay:=app_private.claim_command('apply_import_data',p_command);
  select revision,plan_revision,inventory_revision,shopping_revision
    into v_revision,v_plan_revision,v_inventory_revision,v_shopping_revision
    from public.households where id=v_household for update;
  if not found then perform app_private.fail('NOT_FOUND'); end if;
  perform app_private.assert_role(v_household,array['owner','editor']);
  if v_replay is not null then return v_replay; end if;
  perform app_private.assert_revision(p_command,v_household,v_revision);
  select * into v_preview from public.data_import_previews
    where id=v_preview_id and household_id=v_household and user_id=auth.uid() for update;
  if not found or v_preview.expires_at<=clock_timestamp() or v_preview.consumed_at is not null
  then perform app_private.fail('IMPORT_PREVIEW_EXPIRED'); end if;
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
  insert into app_private.private_profile_import_origins(profile_id,source_household_id,source_profile_id)
  select app_private.import_map_uuid(v_ids,'private_profiles',r.value->>'id'),v_source,(r.value->>'id')::uuid
  from jsonb_array_elements(v_preview.input_payload->'records'->'private_profiles') r(value);
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

-- Expiry is a read/apply boundary, not a claim of physical TTL deletion. A real
-- service-only sweep removes expired rows even when no users visit the app.
create or replace function public.purge_expired_import_previews()
returns integer language plpgsql security definer set search_path = ''
as $$
declare v_count integer;
begin
  delete from public.data_import_previews where expires_at<=clock_timestamp();
  get diagnostics v_count=row_count;
  return v_count;
end $$;
revoke all on function public.purge_expired_import_previews() from public,anon,authenticated;
grant execute on function public.purge_expired_import_previews() to service_role;
revoke all on function app_private.dispose_consumed_import_payload() from public,anon,authenticated;
revoke all on function app_private.claim_command(text,jsonb) from public,anon,authenticated;
revoke all on function public.create_invitation(jsonb),public.accept_invitation(jsonb),
  public.change_member_role(jsonb),public.remove_member(jsonb),public.delete_private_profile(jsonb),
  public.apply_import_data(jsonb) from public,anon;
grant execute on function public.create_invitation(jsonb),public.accept_invitation(jsonb),
  public.change_member_role(jsonb),public.remove_member(jsonb),public.delete_private_profile(jsonb),
  public.apply_import_data(jsonb) to authenticated;

-- The parent confirmed pg_cron is available and preloaded. Scheduling is part
-- of the migration, not an opportunistic user-command TTL or a warning-only
-- fallback. A missing extension/scheduling privilege must fail installation.
create extension if not exists pg_cron with schema pg_catalog;
select cron.schedule('supper-board-preview-retention','*/5 * * * *',
  'select public.purge_expired_import_previews();');

-- public/auth/app_private-only restores omit the cron extension/job catalog:
-- after restoring, enable pg_cron and repeat the exact named schedule above.
-- The job text and integer result contain no user IDs or private body values.

comment on function public.purge_expired_import_previews() is
  'Service-only physical expiry sweep, scheduled every five minutes by pg_cron. Restore cron extension and named job separately from public/auth/app_private dumps.';
comment on table app_private.private_profile_import_origins is
  'Exact source identities for private erasure after UUID remapping; older imports without a saved map are not guessed from body data.';
