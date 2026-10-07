create schema if not exists app_private;
revoke all on schema app_private from public,anon,authenticated;

create or replace function app_private.fail(p_code text)
returns void language plpgsql security definer set search_path = ''
as $$ begin raise exception using message=p_code,errcode='P0001'; end $$;

create or replace function app_private.claim_command(p_action text,p_command jsonb)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_operation uuid;
  v_payload jsonb;
  v_hash text;
  v_prior public.operation_receipts%rowtype;
  v_rows integer;
begin
  if v_user is null then perform app_private.fail('AUTH_REQUIRED'); end if;
  if jsonb_typeof(p_command)<>'object' or jsonb_typeof(p_command->'payload')<>'object' or jsonb_typeof(p_command->'expectedRevisions')<>'object' then perform app_private.fail('VALIDATION'); end if;
  begin v_operation := (p_command->>'operationId')::uuid; exception when others then perform app_private.fail('VALIDATION'); end;
  v_payload := p_command->'payload';
  v_hash := encode(extensions.digest(convert_to(p_action||':'||v_payload::text,'UTF8'),'sha256'),'hex');
  insert into public.operation_receipts(user_id,operation_id,action,payload_hash)
  values (v_user,v_operation,p_action,v_hash)
  on conflict (user_id,operation_id) do nothing;
  get diagnostics v_rows = row_count;
  if v_rows=0 then
    select * into v_prior from public.operation_receipts r where r.user_id=v_user and r.operation_id=v_operation for update;
    if v_prior.action<>p_action or v_prior.payload_hash<>v_hash then perform app_private.fail('IDEMPOTENCY_CONFLICT'); end if;
    if v_prior.result is null then perform app_private.fail('COMMAND_IN_PROGRESS'); end if;
    return v_prior.result || jsonb_build_object('replayed',true);
  end if;
  return null;
end $$;

create or replace function app_private.complete_command(p_operation uuid,p_result jsonb)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  update public.operation_receipts set result=p_result,completed_at=now()
  where user_id=auth.uid() and operation_id=p_operation and result is null;
  if not found then perform app_private.fail('COMMAND_RECEIPT_ERROR'); end if;
end $$;

create or replace function app_private.assert_role(p_household uuid,p_roles text[])
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is null then perform app_private.fail('AUTH_REQUIRED'); end if;
  if not public.has_household_role(p_household,p_roles) then perform app_private.fail('FORBIDDEN'); end if;
end $$;

create or replace function app_private.assert_revision(p_command jsonb,p_aggregate uuid,p_actual integer)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_revisions jsonb := p_command->'expectedRevisions'; v_expected text;
begin
  if v_revisions is null or not (v_revisions ? p_aggregate::text) then perform app_private.fail('REVISION_REQUIRED'); end if;
  v_expected := v_revisions->>p_aggregate::text;
  if v_expected is null or v_expected !~ '^[0-9]+$' or v_expected::integer<>p_actual then perform app_private.fail('REVISION_CONFLICT'); end if;
end $$;

create or replace function app_private.assert_new_revision(p_command jsonb,p_key text default 'new')
returns void language plpgsql security definer set search_path = ''
as $$
declare v_revisions jsonb := p_command->'expectedRevisions';
begin
  if v_revisions is null or not (v_revisions ? p_key) or jsonb_typeof(v_revisions->p_key)<>'null' then perform app_private.fail('REVISION_REQUIRED'); end if;
end $$;

create or replace function app_private.assert_food_scope(p_food_version uuid,p_household uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_source uuid; v_owner_household uuid; v_owner_user uuid;
begin
  select f.source_id,f.owner_household_id,f.owner_user_id into v_source,v_owner_household,v_owner_user
  from public.food_versions v join public.foods f on f.id=v.food_id where v.id=p_food_version;
  if not found then perform app_private.fail('NOT_FOUND'); end if;
  if v_source is not null or v_owner_household=p_household or v_owner_user=auth.uid() then return; end if;
  perform app_private.fail('FOREIGN_ID');
end $$;

create or replace function app_private.assert_date(p_date text)
returns date language plpgsql immutable security definer set search_path = ''
as $$ declare v_date date; begin
  begin v_date:=p_date::date; exception when others then perform app_private.fail('VALIDATION'); end;
  if to_char(v_date,'YYYY-MM-DD')<>p_date then perform app_private.fail('VALIDATION'); end if;
  return v_date;
end $$;

create or replace function public.create_household_with_owner_person(p_command jsonb)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare v_replay jsonb; v_user uuid:=auth.uid(); v_payload jsonb:=p_command->'payload'; v_household uuid; v_person uuid; v_op uuid; v_mode text; v_result jsonb;
begin
  v_replay:=app_private.claim_command('create_household_with_owner_person',p_command); if v_replay is not null then return v_replay; end if;
  if p_command->'expectedRevisions' <> '{}'::jsonb then perform app_private.fail('REVISION_REQUIRED'); end if;
  v_op:=(p_command->>'operationId')::uuid;
  v_mode:=coalesce(v_payload->>'nutritionMode','view');
  if v_mode not in ('view','manual','guided') then perform app_private.fail('VALIDATION'); end if;
  insert into public.households(name,locale,country_code,currency,time_zone)
  values (btrim(v_payload->>'name'),coalesce(v_payload->>'locale','de-DE'),coalesce(v_payload->>'countryCode','DE'),coalesce(v_payload->>'currency','EUR'),coalesce(v_payload->>'timeZone','Europe/Berlin')) returning id into v_household;
  insert into public.household_members(household_id,user_id,role) values(v_household,v_user,'owner');
  insert into public.persons(household_id,display_name,linked_user_id,nutrition_mode)
  values(v_household,btrim(v_payload->>'displayName'),v_user,v_mode) returning id into v_person;
  v_result:=jsonb_build_object('operationId',v_op,'replayed',false,'result',jsonb_build_object('householdId',v_household,'personId',v_person,'ownerUserId',v_user),'revisions',jsonb_build_object(v_household::text,1));
  perform app_private.complete_command(v_op,v_result); return v_result;
end $$;

create or replace function public.save_household(p_command jsonb)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare v_replay jsonb; p jsonb:=p_command->'payload'; v_household uuid:=(p->>'householdId')::uuid; v_op uuid:=(p_command->>'operationId')::uuid; v_actual integer; v_new integer; v_result jsonb;
begin
  v_replay:=app_private.claim_command('save_household',p_command); if v_replay is not null then return v_replay; end if;
  perform app_private.assert_role(v_household,array['owner','editor']);
  select revision into v_actual from public.households where id=v_household for update;
  if not found then perform app_private.fail('NOT_FOUND'); end if;
  perform app_private.assert_revision(p_command,v_household,v_actual);
  update public.households set
    name=case when p->'patch' ? 'name' then btrim(p->'patch'->>'name') else name end,
    locale=case when p->'patch' ? 'locale' then p->'patch'->>'locale' else locale end,
    country_code=case when p->'patch' ? 'countryCode' then p->'patch'->>'countryCode' else country_code end,
    currency=case when p->'patch' ? 'currency' then p->'patch'->>'currency' else currency end,
    time_zone=case when p->'patch' ? 'timeZone' then p->'patch'->>'timeZone' else time_zone end,
    revision=revision+1
  where id=v_household returning revision into v_new;
  v_result:=jsonb_build_object('operationId',v_op,'replayed',false,'result',jsonb_build_object('householdId',v_household),'revisions',jsonb_build_object(v_household::text,v_new));
  perform app_private.complete_command(v_op,v_result); return v_result;
end $$;

create or replace function public.create_person(p_command jsonb)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare v_replay jsonb; p jsonb:=p_command->'payload'; v_household uuid:=(p->>'householdId')::uuid; v_linked uuid; v_person uuid; v_op uuid:=(p_command->>'operationId')::uuid; v_mode text;
begin
  v_replay:=app_private.claim_command('create_person',p_command); if v_replay is not null then return v_replay; end if;
  perform app_private.assert_role(v_household,array['owner','editor']); perform app_private.assert_new_revision(p_command);
  v_linked:=nullif(p->>'linkedUserId','')::uuid;
  if v_linked is not null and v_linked<>auth.uid() then perform app_private.fail('FORBIDDEN'); end if;
  v_mode:=coalesce(p->>'nutritionMode','view'); if v_mode not in ('view','manual','guided') then perform app_private.fail('VALIDATION'); end if;
  insert into public.persons(household_id,display_name,linked_user_id,nutrition_mode) values(v_household,btrim(p->>'displayName'),v_linked,v_mode) returning id into v_person;
  perform app_private.complete_command(v_op,jsonb_build_object('operationId',v_op,'replayed',false,'result',jsonb_build_object('personId',v_person),'revisions',jsonb_build_object()));
  return (select result from public.operation_receipts where user_id=auth.uid() and operation_id=v_op);
end $$;

create or replace function public.create_invitation(p_command jsonb)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare v_replay jsonb; p jsonb:=p_command->'payload'; v_household uuid:=(p->>'householdId')::uuid; v_role text:=coalesce(p->>'role','viewer'); v_email text:=nullif(lower(btrim(p->>'email')),''); v_token text:=encode(extensions.gen_random_bytes(32),'hex'); v_invite uuid; v_op uuid:=(p_command->>'operationId')::uuid; v_exp timestamptz; v_result jsonb;
begin
  v_replay:=app_private.claim_command('create_invitation',p_command); if v_replay is not null then return v_replay; end if;
  perform app_private.assert_role(v_household,array['owner','editor']); perform app_private.assert_new_revision(p_command);
  if v_role not in ('editor','viewer') then perform app_private.fail('VALIDATION'); end if;
  if length(v_token)<>64 then perform app_private.fail('CRYPTO_ERROR'); end if;
  v_exp:=now()+make_interval(hours=>greatest(1,least(coalesce((p->>'expiresInHours')::integer,72),168)));
  insert into public.household_invitations(household_id,invited_email,role,token_hash,invited_by,expires_at)
  values(v_household,v_email,v_role,encode(extensions.digest(convert_to(v_token,'UTF8'),'sha256'),'hex'),auth.uid(),v_exp) returning id into v_invite;
  v_result:=jsonb_build_object('operationId',v_op,'replayed',false,'result',jsonb_build_object('invitationId',v_invite,'token',v_token,'expiresAt',v_exp),'revisions',jsonb_build_object());
  perform app_private.complete_command(v_op,v_result); return v_result;
end $$;

create or replace function public.accept_invitation(p_command jsonb)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare v_replay jsonb; p jsonb:=p_command->'payload'; v_token text:=p->>'token'; v_hash text; v_user uuid:=auth.uid(); v_email text; v_inv public.household_invitations%rowtype; v_person uuid; v_name text; v_op uuid:=(p_command->>'operationId')::uuid; v_result jsonb;
begin
  v_replay:=app_private.claim_command('accept_invitation',p_command); if v_replay is not null then return v_replay; end if;
  v_hash:=encode(extensions.digest(convert_to(v_token,'UTF8'),'sha256'),'hex');
  select * into v_inv from public.household_invitations where token_hash=v_hash for update;
  if not found or v_inv.accepted_at is not null or v_inv.expires_at<=now() then perform app_private.fail('INVITATION_INVALID'); end if;
  select lower(email) into v_email from auth.users where id=v_user;
  if v_inv.invited_email is not null and v_inv.invited_email<>v_email then perform app_private.fail('INVITATION_EMAIL_MISMATCH'); end if;
  if exists(select 1 from public.household_members m where m.household_id=v_inv.household_id and m.user_id=v_user) then perform app_private.fail('ALREADY_MEMBER'); end if;
  insert into public.household_members(household_id,user_id,role) values(v_inv.household_id,v_user,v_inv.role);
  v_name:=coalesce(nullif(btrim(p->>'displayName'),''),split_part(coalesce(v_email,'Household member'),'@',1));
  select id into v_person from public.persons where household_id=v_inv.household_id and linked_user_id=v_user for update;
  if not found then
    insert into public.persons(household_id,display_name,linked_user_id,nutrition_mode) values(v_inv.household_id,v_name,v_user,'view') returning id into v_person;
  end if;
  update public.household_invitations set accepted_at=now(),accepted_by=v_user where id=v_inv.id;
  v_result:=jsonb_build_object('operationId',v_op,'replayed',false,'result',jsonb_build_object('householdId',v_inv.household_id,'personId',v_person,'role',v_inv.role),'revisions',jsonb_build_object(v_inv.household_id::text,(select revision from public.households where id=v_inv.household_id)));
  perform app_private.complete_command(v_op,v_result); return v_result;
end $$;

create or replace function public.change_member_role(p_command jsonb)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare v_replay jsonb; p jsonb:=p_command->'payload'; v_household uuid:=(p->>'householdId')::uuid; v_user uuid:=(p->>'userId')::uuid; v_role text:=p->>'role'; v_op uuid:=(p_command->>'operationId')::uuid; v_house_revision integer; v_count integer; v_result jsonb;
begin
  v_replay:=app_private.claim_command('change_member_role',p_command); if v_replay is not null then return v_replay; end if;
  select revision into v_house_revision from public.households where id=v_household for update; if not found then perform app_private.fail('NOT_FOUND'); end if;
  perform app_private.assert_role(v_household,array['owner']); perform app_private.assert_revision(p_command,v_household,v_house_revision);
  if v_role not in ('owner','editor','viewer') or not exists(select 1 from public.household_members where household_id=v_household and user_id=v_user) then perform app_private.fail('NOT_FOUND'); end if;
  if v_user=auth.uid() and v_role<>'owner' then
    select count(*) into v_count from public.household_members where household_id=v_household and role='owner';
    if v_count<=1 then perform app_private.fail('LAST_OWNER'); end if;
  end if;
  update public.household_members set role=v_role where household_id=v_household and user_id=v_user;
  update public.households set revision=revision+1 where id=v_household returning revision into v_house_revision;
  v_result:=jsonb_build_object('operationId',v_op,'replayed',false,'result',jsonb_build_object('userId',v_user,'role',v_role),'revisions',jsonb_build_object(v_household::text,v_house_revision));
  perform app_private.complete_command(v_op,v_result); return v_result;
end $$;

create or replace function public.remove_member(p_command jsonb)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare v_replay jsonb; p jsonb:=p_command->'payload'; v_household uuid:=(p->>'householdId')::uuid; v_user uuid:=(p->>'userId')::uuid; v_op uuid:=(p_command->>'operationId')::uuid; v_house_revision integer; v_count integer; v_result jsonb;
begin
  v_replay:=app_private.claim_command('remove_member',p_command); if v_replay is not null then return v_replay; end if;
  select revision into v_house_revision from public.households where id=v_household for update; if not found then perform app_private.fail('NOT_FOUND'); end if;
  perform app_private.assert_role(v_household,array['owner']); perform app_private.assert_revision(p_command,v_household,v_house_revision);
  if not exists(select 1 from public.household_members where household_id=v_household and user_id=v_user) then perform app_private.fail('NOT_FOUND'); end if;
  if exists(select 1 from public.household_members where household_id=v_household and user_id=v_user and role='owner') then
    select count(*) into v_count from public.household_members where household_id=v_household and role='owner';
    if v_count<=1 then perform app_private.fail('LAST_OWNER'); end if;
  end if;
  delete from public.household_members where household_id=v_household and user_id=v_user;
  update public.households set revision=revision+1 where id=v_household returning revision into v_house_revision;
  v_result:=jsonb_build_object('operationId',v_op,'replayed',false,'result',jsonb_build_object('removedUserId',v_user),'revisions',jsonb_build_object(v_household::text,v_house_revision));
  perform app_private.complete_command(v_op,v_result); return v_result;
end $$;

create or replace function public.delete_person(p_command jsonb)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare v_replay jsonb; p jsonb:=p_command->'payload'; v_household uuid:=(p->>'householdId')::uuid; v_person uuid:=(p->>'personId')::uuid; v_op uuid:=(p_command->>'operationId')::uuid;
begin
  v_replay:=app_private.claim_command('delete_person',p_command); if v_replay is not null then return v_replay; end if;
  perform app_private.assert_role(v_household,array['owner','editor']); perform app_private.assert_new_revision(p_command);
  if exists(select 1 from public.meal_allocations where household_id=v_household and person_id=v_person) then perform app_private.fail('PERSON_HAS_HISTORY'); end if;
  if exists(select 1 from public.private_profiles where household_id=v_household and person_id=v_person) then perform app_private.fail('PRIVATE_PROFILE_DEPENDENCY'); end if;
  delete from public.persons where household_id=v_household and id=v_person;
  if not found then perform app_private.fail('NOT_FOUND'); end if;
  perform app_private.complete_command(v_op,jsonb_build_object('operationId',v_op,'replayed',false,'result',jsonb_build_object('personId',v_person),'revisions',jsonb_build_object()));
  return (select result from public.operation_receipts where user_id=auth.uid() and operation_id=v_op);
end $$;

create or replace function public.delete_private_profile(p_command jsonb)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare v_replay jsonb; p jsonb:=p_command->'payload'; v_profile uuid:=(p->>'profileId')::uuid; v_op uuid:=(p_command->>'operationId')::uuid;
begin
  v_replay:=app_private.claim_command('delete_private_profile',p_command); if v_replay is not null then return v_replay; end if;
  if not public.is_profile_owner(v_profile) then perform app_private.fail('FORBIDDEN'); end if;
  delete from public.private_profiles where id=v_profile and owner_user_id=auth.uid(); if not found then perform app_private.fail('NOT_FOUND'); end if;
  perform app_private.complete_command(v_op,jsonb_build_object('operationId',v_op,'replayed',false,'result',jsonb_build_object('profileId',v_profile),'revisions',jsonb_build_object()));
  return (select result from public.operation_receipts where user_id=auth.uid() and operation_id=v_op);
end $$;

create or replace function public.delete_household(p_command jsonb)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare v_replay jsonb; p jsonb:=p_command->'payload'; v_household uuid:=(p->>'householdId')::uuid; v_op uuid:=(p_command->>'operationId')::uuid; v_revision integer; v_name text;
  v_food_versions uuid[];
begin
  v_replay:=app_private.claim_command('delete_household',p_command); if v_replay is not null then return v_replay; end if;
  select revision,name into v_revision,v_name from public.households where id=v_household for update;
  if not found then perform app_private.fail('NOT_FOUND'); end if;
  perform app_private.assert_role(v_household,array['owner']); perform app_private.assert_revision(p_command,v_household,v_revision);
  if v_name<>p->>'confirmName' then perform app_private.fail('CONFIRMATION_MISMATCH'); end if;
  if exists(select 1 from public.private_profiles where household_id=v_household and owner_user_id<>auth.uid()) then perform app_private.fail('PRIVATE_PROFILE_DEPENDENCY'); end if;
  delete from public.private_profiles where household_id=v_household and owner_user_id=auth.uid();
  -- RESTRICT edges must be removed before household CASCADE reaches persons or owned foods.
  delete from public.feedback where household_id=v_household;
  delete from public.plan_drafts where household_id=v_household;
  delete from public.procurement_positions where household_id=v_household;
  delete from public.inventory_movements where household_id=v_household and reversal_of_id is not null;
  delete from public.inventory_movements where household_id=v_household;
  delete from public.plans where household_id=v_household;
  delete from public.recipes where household_id=v_household;
  select coalesce(array_agg(v.id),'{}'::uuid[]) into v_food_versions
  from public.food_versions v join public.foods f on f.id=v.food_id
  where f.owner_household_id=v_household;
  delete from public.food_nutrient_values where food_version_id=any(v_food_versions);
  delete from public.food_categories where food_version_id=any(v_food_versions);
  delete from public.food_tags where food_version_id=any(v_food_versions);
  delete from public.food_synonyms where food_version_id=any(v_food_versions);
  delete from public.food_measures where food_version_id=any(v_food_versions);
  delete from public.food_versions where id=any(v_food_versions);
  delete from public.households where id=v_household;
  perform app_private.complete_command(v_op,jsonb_build_object('operationId',v_op,'replayed',false,'result',jsonb_build_object('householdId',v_household),'revisions',jsonb_build_object()));
  return (select result from public.operation_receipts where user_id=auth.uid() and operation_id=v_op);
end $$;

create or replace function app_private.validate_private_profile_input()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare v_today date;
begin
  select (now() at time zone h.time_zone)::date into v_today from public.households h where h.id=new.household_id;
  if (new.birth_date is not null and new.age_years is not null)
    or ((new.age_years is null) <> (new.age_as_of_date is null))
    or ((new.weight_kg is null) <> (new.weight_measured_on is null))
    or new.birth_date>v_today or new.age_as_of_date>v_today or new.weight_measured_on>v_today
  then perform app_private.fail('VALIDATION'); end if;
  return new;
end $$;
create trigger private_profiles_validate_input before insert or update on public.private_profiles
for each row execute function app_private.validate_private_profile_input();

update public.private_profiles profile set imported_unverified=true
where not profile.imported_unverified and (
  exists(select 1 from public.persons person where person.id=profile.person_id and person.linked_user_id is null)
  or exists(select 1 from public.energy_estimates estimate where estimate.profile_id=profile.id and estimate.imported_unverified)
  or exists(select 1 from public.target_versions version where version.profile_id=profile.id and version.imported_unverified)
);

create or replace function public.save_private_profile(p_command jsonb)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_replay jsonb; v_result jsonb; p jsonb:=p_command->'payload'; v_person uuid:=(p->>'personId')::uuid; v_profile uuid; v_household uuid; v_revision integer; v_new_revision integer; v_op uuid:=(p_command->>'operationId')::uuid; v_existing boolean; v_mode text;
  v_profile_row public.private_profiles%rowtype; v_today date; v_age integer; v_ree numeric; v_maintenance numeric;
begin
  v_replay:=app_private.claim_command('save_private_profile',p_command); if v_replay is not null then return v_replay; end if;
  select person.household_id into v_household from public.persons person
  where person.id=v_person and (
    person.linked_user_id=auth.uid()
    or (person.linked_user_id is null and exists(
      select 1 from public.private_profiles profile
      where profile.person_id=person.id and profile.owner_user_id=auth.uid()
        and profile.id=nullif(p->>'profileId','')::uuid
    ))
  );
  if not found then perform app_private.fail('FORBIDDEN'); end if;
  perform app_private.assert_role(v_household,array['owner','editor','viewer']);
  select id,revision into v_profile,v_revision from public.private_profiles where person_id=v_person for update;
  v_existing:=found;
  if v_existing then
    if v_profile<>nullif(p->>'profileId','')::uuid then perform app_private.fail('FORBIDDEN'); end if;
    if not public.is_profile_owner(v_profile) then perform app_private.fail('FORBIDDEN'); end if;
    perform app_private.assert_revision(p_command,v_profile,v_revision);
    update public.private_profiles set
      birth_date=case when p ? 'birthDate' then nullif(p->>'birthDate','')::date else birth_date end,
      age_years=case when p ? 'ageYears' then nullif(p->>'ageYears','')::smallint else age_years end,
      age_as_of_date=case when p ? 'ageAsOfDate' then nullif(p->>'ageAsOfDate','')::date else age_as_of_date end,
      height_cm=case when p ? 'heightCm' then nullif(p->>'heightCm','')::numeric else height_cm end,
      weight_kg=case when p ? 'weightKg' then nullif(p->>'weightKg','')::numeric else weight_kg end,
      weight_measured_on=case when p ? 'weightMeasuredOn' then nullif(p->>'weightMeasuredOn','')::date else weight_measured_on end,
      activity_description=case when p ? 'activityDescription' then nullif(p->>'activityDescription','') else activity_description end,
      source_calculation_group=case when p ? 'sourceCalculationGroup' then nullif(p->>'sourceCalculationGroup','') else source_calculation_group end,
      reference_context=case when p ? 'referenceContext' then p->>'referenceContext' else reference_context end,
      pal=case when p ? 'pal' then nullif(p->>'pal','')::numeric else pal end,
      preferences=case when p ? 'preferences' then coalesce(p->'preferences','[]'::jsonb) else preferences end,
      exclusions=case when p ? 'exclusions' then coalesce(p->'exclusions','[]'::jsonb) else exclusions end,
      share_targets_with_household=case when p ? 'shareTargetsWithHousehold' then (p->>'shareTargetsWithHousehold')::boolean else share_targets_with_household end,
      imported_unverified=imported_unverified or exists(select 1 from public.persons person where person.id=v_person and person.linked_user_id is null),
      revision=revision+1
    where id=v_profile returning revision into v_new_revision;
  else
    perform app_private.assert_new_revision(p_command);
    v_mode:=coalesce(p->>'nutritionMode','view'); if v_mode not in ('view','manual','guided') then perform app_private.fail('VALIDATION'); end if;
    insert into public.private_profiles(household_id,person_id,owner_user_id,birth_date,age_years,age_as_of_date,height_cm,weight_kg,weight_measured_on,activity_description,source_calculation_group,reference_context,pal,preferences,exclusions,share_targets_with_household)
    values(v_household,v_person,auth.uid(),nullif(p->>'birthDate','')::date,nullif(p->>'ageYears','')::smallint,nullif(p->>'ageAsOfDate','')::date,nullif(p->>'heightCm','')::numeric,nullif(p->>'weightKg','')::numeric,nullif(p->>'weightMeasuredOn','')::date,nullif(p->>'activityDescription',''),nullif(p->>'sourceCalculationGroup',''),coalesce(p->>'referenceContext','standard_adult'),nullif(p->>'pal','')::numeric,coalesce(p->'preferences','[]'::jsonb),coalesce(p->'exclusions','[]'::jsonb),coalesce((p->>'shareTargetsWithHousehold')::boolean,false)) returning id,revision into v_profile,v_new_revision;
  end if;
  if p ? 'nutritionMode' then
    v_mode:=p->>'nutritionMode'; if v_mode not in ('view','manual','guided') then perform app_private.fail('VALIDATION'); end if;
    update public.persons set nutrition_mode=v_mode where id=v_person and household_id=v_household;
  end if;
  if p ? 'weightKg' and nullif(p->>'weightKg','') is not null and nullif(p->>'weightMeasuredOn','') is not null then
    insert into public.profile_measurements(profile_id,measurement_type,value,unit,measured_on) values(v_profile,'weight',(p->>'weightKg')::numeric,'kg',(p->>'weightMeasuredOn')::date) on conflict(profile_id,measurement_type,measured_on) do update set value=excluded.value;
  end if;
  select * into v_profile_row from public.private_profiles where id=v_profile;
  select (now() at time zone h.time_zone)::date,pe.nutrition_mode into v_today,v_mode
  from public.households h join public.persons pe on pe.household_id=h.id where pe.id=v_person;
  if v_profile_row.birth_date is not null then
    v_age:=extract(year from age(v_today,v_profile_row.birth_date))::integer;
  elsif v_profile_row.age_as_of_date=v_today then
    v_age:=v_profile_row.age_years;
  end if;
  if v_mode='guided' and v_profile_row.reference_context='standard_adult' and v_age between 19 and 78
    and v_profile_row.height_cm is not null and v_profile_row.weight_kg is not null
    and v_profile_row.weight_measured_on is not null and v_profile_row.pal is not null
    and v_profile_row.source_calculation_group in ('male','female')
  then
    v_ree:=10*v_profile_row.weight_kg+6.25*v_profile_row.height_cm-5*v_age
      +case v_profile_row.source_calculation_group when 'male' then 5 else -161 end;
    v_maintenance:=v_ree*v_profile_row.pal;
    if public.numeric_is_finite(v_ree) and v_ree>0 and public.numeric_is_finite(v_maintenance) and v_maintenance>0 then
      insert into public.energy_estimates(profile_id,model_version,calculation_date,input_snapshot,ree_kcal_per_day,maintenance_kcal_per_day,imported_unverified)
      values(v_profile,'mifflin_st_jeor_1990_simplified_v1',v_today,jsonb_build_object(
        'profileRevision',v_new_revision,'calculationDate',v_today,'birthDate',v_profile_row.birth_date,
        'ageYears',v_age,'ageAsOfDate',v_profile_row.age_as_of_date,
        'heightCm',v_profile_row.height_cm::text,'weightKg',v_profile_row.weight_kg::text,
        'weightMeasuredOn',v_profile_row.weight_measured_on,'pal',v_profile_row.pal::text,
        'sourceCalculationGroup',v_profile_row.source_calculation_group,'referenceContext',v_profile_row.reference_context
      ),v_ree,v_maintenance,v_profile_row.imported_unverified);
    end if;
  end if;
  v_result:=jsonb_build_object('operationId',v_op,'replayed',false,'result',jsonb_build_object('profileId',v_profile,'personId',v_person),'revisions',jsonb_build_object(v_profile::text,v_new_revision));
  perform app_private.complete_command(v_op,v_result); return v_result;
end $$;

create or replace function public.save_target_version(p_command jsonb)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare p jsonb:=p_command->'payload'; v_replay jsonb; v_profile uuid:=(p->>'profileId')::uuid; v_profile_revision integer; v_profile_row public.private_profiles%rowtype; v_version uuid; v_version_number integer; v_item jsonb; v_kind text; v_origin text:=p->>'origin'; v_item_origin text; v_refpack uuid:=nullif(p->>'referencePackId','')::uuid; v_item_refpack uuid; v_item_refvalue uuid; v_reference public.reference_values%rowtype; v_item_id uuid; v_refinputs jsonb; v_reference_age numeric; v_confirmed_weight numeric; v_planning_energy numeric; v_factor numeric; v_expected_min numeric; v_expected_max numeric; v_valid_from date:=app_private.assert_date(p->>'validFrom'); v_op uuid:=(p_command->>'operationId')::uuid; v_items jsonb:=coalesce(p->'items','[]'::jsonb); v_result jsonb;
  v_retained boolean; v_calculation_date date;
  v_base uuid:=nullif(p->>'baseVersionId','')::uuid; v_imported boolean:=false;
begin
  v_replay:=app_private.claim_command('save_target_version',p_command); if v_replay is not null then return v_replay; end if;
  select * into v_profile_row from public.private_profiles where id=v_profile for update;
  if not found or v_profile_row.owner_user_id<>auth.uid() then perform app_private.fail('FORBIDDEN'); end if;
  perform app_private.assert_revision(p_command,v_profile,v_profile_row.revision);
  select (now() at time zone h.time_zone)::date into v_calculation_date
  from public.households h where h.id=v_profile_row.household_id;
  if v_origin not in ('manual','adopted_reference','professional_entered') or jsonb_typeof(v_items)<>'array' then perform app_private.fail('VALIDATION'); end if;
  if jsonb_array_length(v_items)=0 then perform app_private.fail('VALIDATION'); end if;
  if v_refpack is not null and not exists(select 1 from public.reference_packs where id=v_refpack and review_status='approved') then perform app_private.fail('REFERENCE_NOT_APPROVED'); end if;
  v_imported:=v_profile_row.imported_unverified or exists(select 1 from public.target_versions version where version.profile_id=v_profile and version.imported_unverified);
  if v_base is not null then
    select v_imported or imported_unverified into v_imported from public.target_versions where id=v_base and profile_id=v_profile;
    if not found then perform app_private.fail('FORBIDDEN'); end if;
  end if;
  select coalesce(max(version_number),0)+1 into v_version_number from public.target_versions where profile_id=v_profile;
  insert into public.target_versions(household_id,profile_id,version_number,valid_from,origin,imported_unverified,reference_pack_id,note) values(v_profile_row.household_id,v_profile,v_version_number,(p->>'validFrom')::date,v_origin,v_imported,v_refpack,nullif(p->>'note','')) returning id into v_version;
  for v_item in select value from jsonb_array_elements(v_items) loop
    v_kind:=v_item->>'targetKind';
    v_item_origin:=coalesce(nullif(v_item->>'origin',''),v_origin);
    v_item_refpack:=nullif(v_item->>'referencePackId','')::uuid;
    v_item_refvalue:=nullif(v_item->>'referenceValueId','')::uuid;
    v_refinputs:=coalesce(v_item->'referenceInputs','{}'::jsonb);
    if coalesce(v_kind,'') not in ('point','range','minimum','maximum') or v_item_origin not in ('manual','adopted_reference','professional_entered')
      or jsonb_typeof(v_refinputs)<>'object' or octet_length(v_refinputs::text)>4096
    then perform app_private.fail('VALIDATION'); end if;
    if v_item_origin='adopted_reference' and v_item_refpack is null then v_item_refpack:=v_refpack; end if;
    if (v_item_refpack is null) is distinct from (v_item_refvalue is null) then perform app_private.fail('VALIDATION'); end if;
    v_reference:=null;
    if v_item_refvalue is not null then
      select * into v_reference from public.reference_values where id=v_item_refvalue and reference_pack_id=v_item_refpack;
      if not found or v_item->>'nutrientCode'<>v_reference.nutrient_code then perform app_private.fail('REFERENCE_NOT_APPROVED'); end if;
      if v_reference.reference_kind='safe_and_adequate' or v_reference.reference_type='safe_adequate'
      then perform app_private.fail('REFERENCE_NOT_APPLICABLE'); end if;
    end if;
    if v_item_origin='adopted_reference' then
      if v_item_refpack is null or not exists(select 1 from public.reference_packs rp where rp.id=v_item_refpack and rp.review_status='approved')
      then perform app_private.fail('REFERENCE_NOT_APPROVED'); end if;
      -- Unchanged snapshots keep their original inputs and the explicitly selected base version's verification state.
      select exists(
        select 1 from public.target_items old_item
        join public.target_versions old_version on old_version.id=old_item.target_version_id
        left join public.target_item_private_inputs old_inputs on old_inputs.target_item_id=old_item.id
        where old_version.id=v_base and old_version.profile_id=v_profile and old_item.origin='adopted_reference'
          and old_item.nutrient_code=v_item->>'nutrientCode' and old_item.unit=v_item->>'unit'
          and old_item.target_kind=v_kind and old_item.reference_pack_id=v_item_refpack
          and old_item.reference_value_id=v_item_refvalue
          and old_item.minimum is not distinct from nullif(v_item->>'minimum','')::numeric
          and old_item.maximum is not distinct from nullif(v_item->>'maximum','')::numeric
          and old_item.point_value is not distinct from nullif(v_item->>'pointValue','')::numeric
          and coalesce(old_inputs.inputs,'{}'::jsonb)=v_refinputs
      ) into v_retained;
      if not v_retained then
        if v_profile_row.reference_context<>'standard_adult' then perform app_private.fail('REFERENCE_NOT_APPLICABLE'); end if;
        if v_profile_row.birth_date is not null then
          v_reference_age:=extract(year from age(v_calculation_date,v_profile_row.birth_date));
        elsif v_profile_row.age_years is not null and v_profile_row.age_as_of_date=v_calculation_date then
          v_reference_age:=v_profile_row.age_years;
        else v_reference_age:=null; end if;
        if v_reference_age is null or v_reference_age<18
          or v_reference.age_min_years is not null and v_reference_age<v_reference.age_min_years
          or v_reference.age_max_years is not null and v_reference_age>v_reference.age_max_years
        then perform app_private.fail('REFERENCE_NOT_APPLICABLE'); end if;
        if v_reference.cohort='adult_male' and v_profile_row.source_calculation_group is distinct from 'male'
          or v_reference.cohort='adult_female' and v_profile_row.source_calculation_group is distinct from 'female'
          or v_reference.cohort not in ('adult_male','adult_female','adult_both_sexes')
        then perform app_private.fail('REFERENCE_NOT_APPLICABLE'); end if;
      end if;
      case v_reference.reference_kind
        when 'point' then
          if v_kind<>'point' or v_item->>'unit'<>v_reference.unit
            or nullif(v_item->>'pointValue','')::numeric is distinct from v_reference.value
          then perform app_private.fail('REFERENCE_NOT_APPLICABLE'); end if;
        when 'per_kg' then
          begin v_confirmed_weight:=nullif(v_refinputs->>'confirmedWeightKg','')::numeric; exception when others then perform app_private.fail('VALIDATION'); end;
          if v_kind<>'point' or v_item->>'unit'<>v_reference.target_unit
            or not public.numeric_is_finite(v_confirmed_weight) or v_confirmed_weight<=0
            or nullif(v_item->>'pointValue','')::numeric is distinct from v_reference.value*v_confirmed_weight
          then perform app_private.fail('REFERENCE_NOT_APPLICABLE'); end if;
          if not v_retained and (
            v_confirmed_weight is distinct from v_profile_row.weight_kg
            or v_profile_row.weight_measured_on is null
            or v_profile_row.weight_measured_on>v_calculation_date
          ) then perform app_private.fail('REFERENCE_NOT_APPLICABLE'); end if;
        when 'range' then
          if v_kind<>'range' or v_item->>'unit'<>v_reference.unit
            or nullif(v_item->>'minimum','')::numeric is distinct from v_reference.minimum
            or nullif(v_item->>'maximum','')::numeric is distinct from v_reference.maximum
          then perform app_private.fail('REFERENCE_NOT_APPLICABLE'); end if;
        when 'energy_percent' then
          if v_kind<>'range' then perform app_private.fail('REFERENCE_NOT_APPLICABLE'); end if;
          if v_item->>'unit'='energy_percent' then
            if nullif(v_item->>'minimum','')::numeric is distinct from v_reference.minimum
              or nullif(v_item->>'maximum','')::numeric is distinct from v_reference.maximum
            then perform app_private.fail('REFERENCE_NOT_APPLICABLE'); end if;
          elsif v_item->>'unit'='g' then
            begin v_planning_energy:=nullif(v_refinputs->>'planningEnergyKcal','')::numeric; exception when others then perform app_private.fail('VALIDATION'); end;
            v_factor:=case v_reference.nutrient_code when 'protein' then 4 when 'available_carbohydrate' then 4 when 'fat' then 9 else null end;
            if not public.numeric_is_finite(v_planning_energy) or v_planning_energy<=0 or v_factor is null
            then perform app_private.fail('REFERENCE_NOT_APPLICABLE'); end if;
            v_expected_min:=v_planning_energy*v_reference.minimum/100/v_factor;
            v_expected_max:=v_planning_energy*v_reference.maximum/100/v_factor;
            if round(nullif(v_item->>'minimum','')::numeric,12) is distinct from round(v_expected_min,12)
              or round(nullif(v_item->>'maximum','')::numeric,12) is distinct from round(v_expected_max,12)
            then perform app_private.fail('REFERENCE_NOT_APPLICABLE'); end if;
          else perform app_private.fail('REFERENCE_NOT_APPLICABLE'); end if;
        else perform app_private.fail('REFERENCE_NOT_APPLICABLE');
      end case;
    end if;
    insert into public.target_items(target_version_id,nutrient_code,unit,origin,target_kind,minimum,maximum,point_value,reference_pack_id,reference_value_id,manually_locked)
    values(v_version,v_item->>'nutrientCode',v_item->>'unit',v_item_origin,v_kind,nullif(v_item->>'minimum','')::numeric,nullif(v_item->>'maximum','')::numeric,nullif(v_item->>'pointValue','')::numeric,v_item_refpack,v_item_refvalue,coalesce((v_item->>'manuallyLocked')::boolean,false))
    returning id into v_item_id;
    if v_refinputs<>'{}'::jsonb then
      insert into public.target_item_private_inputs(target_item_id,target_version_id,profile_id,inputs)
      values(v_item_id,v_version,v_profile,v_refinputs);
    end if;
  end loop;
  if v_origin='adopted_reference' and not exists(select 1 from public.target_items where target_version_id=v_version and origin='adopted_reference')
  then perform app_private.fail('REFERENCE_NOT_APPROVED'); end if;
  update public.private_profiles set revision=revision+1 where id=v_profile returning revision into v_profile_revision;
  v_result:=jsonb_build_object('operationId',v_op,'replayed',false,'result',jsonb_build_object('targetVersionId',v_version,'profileId',v_profile,'versionNumber',v_version_number),'revisions',jsonb_build_object(v_profile::text,v_profile_revision));
  perform app_private.complete_command(v_op,v_result); return v_result;
end $$;

create or replace function public.create_household_food(p_command jsonb)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare p jsonb:=p_command->'payload'; v_replay jsonb; v_household uuid:=(p->>'householdId')::uuid; v_food uuid; v_version uuid; v_op uuid:=(p_command->>'operationId')::uuid; v_n jsonb; v_nutrient uuid; v_code text; v_amount numeric; v_component text; v_result jsonb; v_version_no integer;
begin
  v_replay:=app_private.claim_command('create_household_food',p_command); if v_replay is not null then return v_replay; end if;
  perform app_private.assert_role(v_household,array['owner','editor']); perform app_private.assert_new_revision(p_command);
  insert into public.foods(source_id,source_food_code,owner_household_id,created_by_user_id,compatibility_key)
  values(null,null,v_household,auth.uid(),nullif(p->>'compatibilityKey','')) returning id into v_food;
  insert into public.food_versions(food_id,source_release_id,version_number,name_de,name_en,preparation_state,source_notes)
  values(v_food,null,1,btrim(p->>'nameDe'),nullif(p->>'nameEn',''),nullif(p->>'preparationState',''),nullif(p->>'sourceNotes','')) returning id into v_version;
  for v_n in select value from jsonb_array_elements(coalesce(p->'nutrients','[]'::jsonb)) loop
    select id,code into v_nutrient,v_code from public.nutrient_definitions where id::text=v_n->>'nutrientId' or code=v_n->>'nutrientId' limit 1;
    if v_nutrient is null then perform app_private.fail('UNKNOWN_NUTRIENT'); end if;
    begin v_amount:=(v_n->>'amount')::numeric; exception when others then perform app_private.fail('VALIDATION'); end;
    if not public.numeric_is_finite(v_amount) or v_amount<0 then perform app_private.fail('VALIDATION'); end if;
    v_component:='USER:'||v_code;
    insert into public.food_nutrient_values(food_version_id,source_component_code,nutrient_definition_id,raw_value,normalized_amount,unit,value_status,source_method,source_reference,mapping_version)
    values(v_version,v_component,v_nutrient,v_amount::text,v_amount,v_n->>'unit',case when v_amount=0 then 'explicit_zero' else 'numeric' end,'user-entered',nullif(v_n->>'sourceReference',''),'user-entered-v1');
  end loop;
  if jsonb_typeof(coalesce(p->'categoryIds','[]'::jsonb))<>'array' then perform app_private.fail('VALIDATION'); end if;
  insert into public.food_categories(food_version_id,category_id,is_primary)
  select v_version,(x.value::text)::uuid,ordinality=1 from jsonb_array_elements_text(coalesce(p->'categoryIds','[]'::jsonb)) with ordinality x(value,ordinality);
  v_result:=jsonb_build_object('operationId',v_op,'replayed',false,'result',jsonb_build_object('foodId',v_food,'foodVersionId',v_version,'nameDe',p->>'nameDe'),'revisions',jsonb_build_object());
  perform app_private.complete_command(v_op,v_result); return v_result;
end $$;

create or replace function public.save_recipe_version(p_command jsonb)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  p jsonb:=p_command->'payload'; v_replay jsonb; v_household uuid:=(p->>'householdId')::uuid;
  v_recipe uuid:=nullif(p->>'recipeId','')::uuid; v_expected uuid:=nullif(p->>'expectedVersionId','')::uuid;
  v_version uuid; v_op uuid:=(p_command->>'operationId')::uuid; v_recipe_revision integer;
  v_version_number integer; v_ingredient jsonb; v_pos integer:=0; v_new_revision integer;
  v_result jsonb; v_food uuid; v_quantity numeric; v_yield numeric; v_weight numeric;
  v_grams numeric; v_new_recipe boolean:=false; v_basis text;
begin
  v_replay:=app_private.claim_command('save_recipe_version',p_command); if v_replay is not null then return v_replay; end if;
  perform app_private.assert_role(v_household,array['owner','editor']);
  if nullif(btrim(p->>'title'),'') is null or length(btrim(p->>'title'))>200
    or jsonb_typeof(coalesce(p->'ingredients','[]'::jsonb))<>'array'
    or jsonb_typeof(coalesce(p->'steps','[]'::jsonb))<>'array'
  then perform app_private.fail('VALIDATION'); end if;
  begin v_yield:=nullif(p->>'baseServings','')::numeric; v_weight:=nullif(p->>'finalWeightG','')::numeric;
  exception when others then perform app_private.fail('VALIDATION'); end;
  if v_yield is not null and (not public.numeric_is_finite(v_yield) or v_yield<=0)
    or v_weight is not null and (not public.numeric_is_finite(v_weight) or v_weight<=0)
  then perform app_private.fail('VALIDATION'); end if;
  if p->>'activeMinutes' is not null and (p->>'activeMinutes') !~ '^[0-9]+$'
    or p->>'totalMinutes' is not null and (p->>'totalMinutes') !~ '^[0-9]+$'
  then perform app_private.fail('VALIDATION'); end if;
  if v_recipe is null then
    perform app_private.assert_new_revision(p_command);
    insert into public.recipes(household_id,owner_user_id,title) values(v_household,auth.uid(),btrim(p->>'title')) returning id,revision into v_recipe,v_recipe_revision;
    v_new_recipe:=true; v_version_number:=1;
  else
    select revision into v_recipe_revision from public.recipes where id=v_recipe and household_id=v_household for update;
    if not found then perform app_private.fail('NOT_FOUND'); end if;
    perform app_private.assert_revision(p_command,v_recipe,v_recipe_revision);
    if v_expected is distinct from (select current_version_id from public.recipes where id=v_recipe) then perform app_private.fail('REVISION_CONFLICT'); end if;
    select coalesce(max(version_number),0)+1 into v_version_number from public.recipe_versions where recipe_id=v_recipe;
  end if;
  insert into public.recipe_versions(recipe_id,household_id,version_number,title,description,base_servings,yield_text,final_weight_g,active_minutes,total_minutes,steps,created_by)
  values(v_recipe,v_household,v_version_number,btrim(p->>'title'),nullif(p->>'description',''),v_yield,nullif(p->>'yieldText',''),v_weight,nullif(p->>'activeMinutes','')::integer,nullif(p->>'totalMinutes','')::integer,coalesce(p->'steps','[]'::jsonb),auth.uid())
  returning id into v_version;
  for v_ingredient in select value from jsonb_array_elements(coalesce(p->'ingredients','[]'::jsonb)) loop
    v_food:=nullif(v_ingredient->>'foodVersionId','')::uuid;
    if v_food is not null then perform app_private.assert_food_scope(v_food,v_household); end if;
    v_basis:=coalesce(v_ingredient->>'basis','unknown');
    if v_basis not in ('edible','purchase','drained','unknown') then perform app_private.fail('VALIDATION'); end if;
    begin
      v_quantity:=nullif(v_ingredient->>'quantity','')::numeric;
      v_grams:=nullif(v_ingredient->>'confirmedGramsPerUnit','')::numeric;
    exception when others then perform app_private.fail('VALIDATION'); end;
    if v_quantity is not null and (not public.numeric_is_finite(v_quantity) or v_quantity<0)
      or v_grams is not null and (not public.numeric_is_finite(v_grams) or v_grams<=0)
      or v_food is null and nullif(v_ingredient->>'originalText','') is null
    then perform app_private.fail('VALIDATION'); end if;
    insert into public.recipe_ingredients(recipe_version_id,position,food_version_id,original_text,quantity,unit,amount_basis,confirmed_grams_per_unit,alternative_group_id,selected_alternative)
    values(v_version,v_pos,v_food,coalesce(v_ingredient->>'originalText',''),v_quantity,coalesce(nullif(v_ingredient->>'unit',''),'unknown'),v_basis,v_grams,nullif(v_ingredient->>'alternativeGroupId',''),coalesce((v_ingredient->>'selectedAlternative')::boolean,false));
    v_pos:=v_pos+1;
  end loop;
  update public.recipes set title=btrim(p->>'title'),current_version_id=v_version,
    revision=case when v_new_recipe then revision else revision+1 end,archived_at=null
  where id=v_recipe returning revision into v_new_revision;
  v_result:=jsonb_build_object('operationId',v_op,'replayed',false,'result',jsonb_build_object('recipeId',v_recipe,'recipeVersionId',v_version,'versionNumber',v_version_number),'revisions',jsonb_build_object(v_recipe::text,v_new_revision));
  perform app_private.complete_command(v_op,v_result); return v_result;
end $$;

-- All user-facing functions are explicit RPCs; no direct table writes or service-role user paths.
revoke execute on all functions in schema public from public,anon,authenticated;
grant execute on function public.has_household_role(uuid,text[]),public.is_profile_owner(uuid),public.can_read_shared_targets(uuid),public.can_read_food(uuid) to anon,authenticated;
grant execute on function public.create_household_with_owner_person(jsonb),public.save_household(jsonb),public.create_person(jsonb),public.create_invitation(jsonb),public.accept_invitation(jsonb),public.change_member_role(jsonb),public.remove_member(jsonb),public.delete_person(jsonb),public.delete_private_profile(jsonb),public.delete_household(jsonb),public.save_private_profile(jsonb),public.save_target_version(jsonb),public.create_household_food(jsonb),public.save_recipe_version(jsonb) to authenticated;
revoke all on all functions in schema app_private from public,anon,authenticated;
