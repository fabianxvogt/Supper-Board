-- INCREMENTAL planning integrity repair. Active periods use inclusive local
-- dates: adjacent periods are valid; shared dates are not. A stale {new:null}
-- command must fail rather than silently attach to a plan it never loaded.
-- Existing overlapping history is retained unchanged (no merge or archive).
-- Both schedule commands, imports and later period changes use this guard.
create or replace function app_private.enforce_active_plan_period()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if new.status <> 'active' then return new; end if;
  if tg_op = 'UPDATE' then
    -- Ordinary revision/title updates and narrowing an existing active period
    -- must remain possible even when pre-migration history overlaps.
    if old.status = 'active' and old.household_id = new.household_id
       and new.start_date >= old.start_date and new.end_date <= old.end_date then
      return new;
    end if;
  end if;
  -- Lock a stable parent, not a nonexistent plan row. The subsequent volatile
  -- query sees the preceding creator's commit after waiting at READ COMMITTED.
  perform 1 from public.households where id = new.household_id for no key update;
  if exists (
    select 1 from public.plans p
    where p.household_id = new.household_id and p.status = 'active'
      and p.id <> new.id
      and p.start_date <= new.end_date and p.end_date >= new.start_date
  ) then
    perform app_private.fail('REVISION_CONFLICT');
  end if;
  return new;
end $$;
revoke all on function app_private.enforce_active_plan_period() from public, anon, authenticated;
create trigger plans_active_period_guard
before insert or update of household_id, status, start_date, end_date on public.plans
for each row execute function app_private.enforce_active_plan_period();

-- Direct-food creation now honors the same explicit window as batch creation.
-- Receipts, authorization, expected revisions and household revision increments
-- remain in the command transaction; the trigger rejects raced new periods.
create or replace function public.schedule_direct_food(p_command jsonb)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  p jsonb := p_command->'payload';
  v_replay jsonb;
  v_household uuid := (p->>'householdId')::uuid;
  v_plan uuid := nullif(p->>'planId','')::uuid;
  v_food uuid := (p->>'foodVersionId')::uuid;
  v_date date := app_private.assert_date(p->>'date');
  v_start date := coalesce(app_private.assert_date(nullif(p->>'planStartDate','')),v_date);
  v_end date := coalesce(app_private.assert_date(nullif(p->>'planEndDate','')),v_date+13);
  v_slot text := p->>'slot';
  v_person uuid := nullif(p->>'personId','')::uuid;
  v_qty numeric;
  v_entry uuid;
  v_plan_rev integer;
  v_house_rev integer;
  v_new_plan boolean := false;
  v_op uuid := (p_command->>'operationId')::uuid;
  v_result jsonb;
begin
  v_replay := app_private.claim_command('schedule_direct_food',p_command);
  if v_replay is not null then return v_replay; end if;
  perform app_private.assert_role(v_household,array['owner','editor']);
  perform app_private.assert_food_scope(v_food,v_household);
  begin v_qty := (p->>'quantityG')::numeric;
  exception when others then perform app_private.fail('VALIDATION'); end;
  if not public.numeric_is_finite(v_qty) or v_qty<=0
     or v_slot not in ('breakfast','lunch','dinner','snack','other') then
    perform app_private.fail('VALIDATION');
  end if;
  if v_plan is null then
    perform app_private.assert_new_revision(p_command);
    if v_end<v_start or v_date<v_start or v_date>v_end then perform app_private.fail('VALIDATION'); end if;
    insert into public.plans(household_id,title,start_date,end_date,status,created_by)
    values(v_household,'Wochenplan',v_start,v_end,'active',auth.uid())
    returning id,revision into v_plan,v_plan_rev;
    v_new_plan := true;
  else
    select revision into v_plan_rev from public.plans
    where id=v_plan and household_id=v_household and status='active' for update;
    if not found then perform app_private.fail('NOT_FOUND'); end if;
    perform app_private.assert_revision(p_command,v_plan,v_plan_rev);
    if not exists(select 1 from public.plans where id=v_plan and v_date between start_date and end_date) then
      perform app_private.fail('VALIDATION');
    end if;
  end if;
  insert into public.meal_entries(household_id,plan_id,entry_date,slot,entry_kind,food_version_id,quantity_g)
  values(v_household,v_plan,v_date,v_slot,'direct_food',v_food,v_qty) returning id into v_entry;
  if v_person is not null then
    insert into public.meal_allocations(household_id,entry_id,person_id,portions)
    values(v_household,v_entry,v_person,1);
  end if;
  if v_new_plan then select revision into v_plan_rev from public.plans where id=v_plan;
  else update public.plans set revision=revision+1 where id=v_plan returning revision into v_plan_rev; end if;
  update public.households set plan_revision=plan_revision+1 where id=v_household returning plan_revision into v_house_rev;
  v_result := jsonb_build_object('operationId',v_op,'replayed',false,
    'result',jsonb_build_object('planId',v_plan,'entryId',v_entry),
    'revisions',jsonb_build_object(v_plan::text,v_plan_rev,v_household::text,v_house_rev));
  perform app_private.complete_command(v_op,v_result);
  return v_result;
end $$;
