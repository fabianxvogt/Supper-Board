create or replace function app_private.capture_plan_state(p_plan uuid,p_entry_ids uuid[])
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare v_entries jsonb; v_batches jsonb; v_reminders jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'date',e.entry_date,'slot',e.slot,'revision',e.revision) order by e.id),'[]'::jsonb)
  into v_entries from public.meal_entries e where e.plan_id=p_plan and e.id=any(p_entry_ids);
  select coalesce(jsonb_agg(jsonb_build_object('id',b.id,'cookDate',b.cook_date,'revision',b.revision) order by b.id),'[]'::jsonb)
  into v_batches from public.planned_batches b where b.plan_id=p_plan and exists(select 1 from public.meal_entries e where e.batch_id=b.id and e.id=any(p_entry_ids) and e.entry_date=b.cook_date);
  select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'date',r.reminder_date,'revision',r.revision) order by r.id),'[]'::jsonb)
  into v_reminders from public.prep_reminders r where r.entry_id=any(p_entry_ids) or r.batch_id in (select b.id from public.planned_batches b where b.plan_id=p_plan and exists(select 1 from public.meal_entries e where e.batch_id=b.id and e.id=any(p_entry_ids)));
  return jsonb_build_object('entries',v_entries,'batches',v_batches,'reminders',v_reminders);
end $$;

create or replace function public.schedule_batch(p_command jsonb)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  p jsonb:=p_command->'payload'; v_replay jsonb; v_household uuid:=(p->>'householdId')::uuid; v_plan uuid:=nullif(p->>'planId','')::uuid; v_recipe_version uuid:=(p->>'recipeVersionId')::uuid; v_cook_date date:=app_private.assert_date(p->>'cookDate'); v_entry_date date:=app_private.assert_date(p->'entry'->>'date'); v_slot text:=p->'entry'->>'slot'; v_portions numeric; v_batch uuid; v_entry uuid; v_person jsonb; v_alloc_total numeric:=0; v_new_plan_rev integer; v_new_house_rev integer; v_new_plan boolean:=false; v_op uuid:=(p_command->>'operationId')::uuid; v_result jsonb;
begin
  v_replay:=app_private.claim_command('schedule_batch',p_command); if v_replay is not null then return v_replay; end if;
  perform app_private.assert_role(v_household,array['owner','editor']);
  begin v_portions:=(p->>'cookPortions')::numeric; exception when others then perform app_private.fail('VALIDATION'); end;
  if not public.numeric_is_finite(v_portions) or v_portions<=0 or v_entry_date<v_cook_date or v_slot not in ('breakfast','lunch','dinner','snack','other') then perform app_private.fail('VALIDATION'); end if;
  if jsonb_typeof(coalesce(p->'allocations','[]'::jsonb))<>'array' then perform app_private.fail('VALIDATION'); end if;
  if v_plan is null then
    perform app_private.assert_new_revision(p_command);
    insert into public.plans(household_id,title,start_date,end_date,status,created_by)
    values(v_household,coalesce(nullif(p->>'planTitle',''),'Wochenplan'),coalesce(nullif(p->>'planStartDate','')::date,v_entry_date),coalesce(nullif(p->>'planEndDate','')::date,v_entry_date+13),'active',auth.uid()) returning id,revision into v_plan,v_new_plan_rev;
    v_new_plan:=true;
  else
    select revision into v_new_plan_rev from public.plans where id=v_plan and household_id=v_household and status='active' for update;
    if not found then perform app_private.fail('NOT_FOUND'); end if;
    perform app_private.assert_revision(p_command,v_plan,v_new_plan_rev);
  end if;
  if not exists(select 1 from public.recipe_versions where id=v_recipe_version and household_id=v_household) then perform app_private.fail('FOREIGN_ID'); end if;
  insert into public.planned_batches(household_id,plan_id,recipe_version_id,cook_date,cook_portions,final_weight_g)
  values(v_household,v_plan,v_recipe_version,v_cook_date,v_portions,nullif(p->>'finalWeightG','')::numeric) returning id into v_batch;
  insert into public.meal_entries(household_id,plan_id,entry_date,slot,entry_kind,batch_id)
  values(v_household,v_plan,v_entry_date,v_slot,'recipe_batch',v_batch) returning id into v_entry;
  for v_person in select value from jsonb_array_elements(coalesce(p->'allocations','[]'::jsonb)) loop
    begin v_alloc_total:=v_alloc_total+(v_person->>'portions')::numeric; exception when others then perform app_private.fail('VALIDATION'); end;
    insert into public.meal_allocations(household_id,entry_id,person_id,portions) values(v_household,v_entry,(v_person->>'personId')::uuid,(v_person->>'portions')::numeric);
  end loop;
  if v_alloc_total>v_portions then perform app_private.fail('ALLOCATION_LIMIT'); end if;
  if v_new_plan then select revision into v_new_plan_rev from public.plans where id=v_plan; else update public.plans set revision=revision+1 where id=v_plan returning revision into v_new_plan_rev; end if;
  update public.households set plan_revision=plan_revision+1 where id=v_household returning plan_revision into v_new_house_rev;
  v_result:=jsonb_build_object('operationId',v_op,'replayed',false,'result',jsonb_build_object('planId',v_plan,'batchId',v_batch,'entryId',v_entry),'revisions',jsonb_build_object(v_plan::text,v_new_plan_rev,v_household::text,v_new_house_rev));
  perform app_private.complete_command(v_op,v_result); return v_result;
end $$;

create or replace function public.allocate_meal(p_command jsonb)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare p jsonb:=p_command->'payload'; v_replay jsonb; v_household uuid:=(p->>'householdId')::uuid; v_batch uuid:=(p->>'batchId')::uuid; v_plan uuid; v_cook_date date; v_capacity numeric; v_completed boolean; v_entry uuid:=nullif(p->'entry'->>'entryId','')::uuid; v_date date:=app_private.assert_date(p->'entry'->>'date'); v_slot text:=p->'entry'->>'slot'; v_plan_rev integer; v_batch_rev integer; v_total numeric; v_person jsonb; v_requested numeric:=0; v_new_plan integer; v_new_batch integer; v_house_rev integer; v_op uuid:=(p_command->>'operationId')::uuid; v_result jsonb;
begin
  v_replay:=app_private.claim_command('allocate_meal',p_command); if v_replay is not null then return v_replay; end if;
  perform app_private.assert_role(v_household,array['owner','editor']);
  select plan_id,cook_date,cook_portions,revision,completed into v_plan,v_cook_date,v_capacity,v_batch_rev,v_completed from public.planned_batches where id=v_batch and household_id=v_household for update;
  if not found then perform app_private.fail('NOT_FOUND'); end if;
  if v_date<v_cook_date or v_slot not in ('breakfast','lunch','dinner','snack','other') then perform app_private.fail('REST_BEFORE_COOK'); end if;
  select revision into v_plan_rev from public.plans where id=v_plan and household_id=v_household for update;
  perform app_private.assert_revision(p_command,v_plan,v_plan_rev); perform app_private.assert_revision(p_command,v_batch,v_batch_rev);
  if jsonb_typeof(coalesce(p->'allocations','[]'::jsonb))<>'array' then perform app_private.fail('VALIDATION'); end if;
  if v_entry is null then
    insert into public.meal_entries(household_id,plan_id,entry_date,slot,entry_kind,batch_id) values(v_household,v_plan,v_date,v_slot,'recipe_batch',v_batch) returning id into v_entry;
  else
    if not exists(select 1 from public.meal_entries where id=v_entry and household_id=v_household and plan_id=v_plan and batch_id=v_batch) then perform app_private.fail('FOREIGN_ID'); end if;
    update public.meal_entries set entry_date=v_date,slot=v_slot,revision=revision+1 where id=v_entry;
    delete from public.meal_allocations where entry_id=v_entry;
  end if;
  for v_person in select value from jsonb_array_elements(coalesce(p->'allocations','[]'::jsonb)) loop
    begin v_requested:=v_requested+(v_person->>'portions')::numeric; exception when others then perform app_private.fail('VALIDATION'); end;
    insert into public.meal_allocations(household_id,entry_id,person_id,portions) values(v_household,v_entry,(v_person->>'personId')::uuid,(v_person->>'portions')::numeric);
  end loop;
  select coalesce(sum(a.portions),0) into v_total from public.meal_allocations a join public.meal_entries e on e.id=a.entry_id where e.batch_id=v_batch;
  if not public.numeric_is_finite(v_total) or v_total>v_capacity then perform app_private.fail('ALLOCATION_LIMIT'); end if;
  update public.plans set revision=revision+1 where id=v_plan returning revision into v_new_plan;
  update public.planned_batches set revision=revision+1 where id=v_batch returning revision into v_new_batch;
  update public.households set plan_revision=plan_revision+1 where id=v_household returning plan_revision into v_house_rev;
  v_result:=jsonb_build_object('operationId',v_op,'replayed',false,'result',jsonb_build_object('planId',v_plan,'batchId',v_batch,'entryId',v_entry,'allocatedPortions',v_total::text),'revisions',jsonb_build_object(v_plan::text,v_new_plan,v_batch::text,v_new_batch,v_household::text,v_house_rev));
  perform app_private.complete_command(v_op,v_result); return v_result;
end $$;

create or replace function public.schedule_direct_food(p_command jsonb)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare p jsonb:=p_command->'payload'; v_replay jsonb; v_household uuid:=(p->>'householdId')::uuid; v_plan uuid:=nullif(p->>'planId','')::uuid; v_food uuid:=(p->>'foodVersionId')::uuid; v_date date:=app_private.assert_date(p->>'date'); v_slot text:=p->>'slot'; v_person uuid:=nullif(p->>'personId','')::uuid; v_qty numeric; v_entry uuid; v_plan_rev integer; v_house_rev integer; v_new_plan boolean:=false; v_op uuid:=(p_command->>'operationId')::uuid; v_result jsonb;
begin
  v_replay:=app_private.claim_command('schedule_direct_food',p_command); if v_replay is not null then return v_replay; end if;
  perform app_private.assert_role(v_household,array['owner','editor']); perform app_private.assert_food_scope(v_food,v_household);
  begin v_qty:=(p->>'quantityG')::numeric; exception when others then perform app_private.fail('VALIDATION'); end;
  if not public.numeric_is_finite(v_qty) or v_qty<=0 or v_slot not in ('breakfast','lunch','dinner','snack','other') then perform app_private.fail('VALIDATION'); end if;
  if v_plan is null then
    perform app_private.assert_new_revision(p_command);
    insert into public.plans(household_id,title,start_date,end_date,status,created_by) values(v_household,'Wochenplan',v_date,v_date+13,'active',auth.uid()) returning id,revision into v_plan,v_plan_rev;
    v_new_plan:=true;
  else
    select revision into v_plan_rev from public.plans where id=v_plan and household_id=v_household and status='active' for update;
    if not found then perform app_private.fail('NOT_FOUND'); end if; perform app_private.assert_revision(p_command,v_plan,v_plan_rev);
  end if;
  insert into public.meal_entries(household_id,plan_id,entry_date,slot,entry_kind,food_version_id,quantity_g)
  values(v_household,v_plan,v_date,v_slot,'direct_food',v_food,v_qty) returning id into v_entry;
  if v_person is not null then insert into public.meal_allocations(household_id,entry_id,person_id,portions) values(v_household,v_entry,v_person,1); end if;
  if v_new_plan then select revision into v_plan_rev from public.plans where id=v_plan; else update public.plans set revision=revision+1 where id=v_plan returning revision into v_plan_rev; end if;
  update public.households set plan_revision=plan_revision+1 where id=v_household returning plan_revision into v_house_rev;
  v_result:=jsonb_build_object('operationId',v_op,'replayed',false,'result',jsonb_build_object('planId',v_plan,'entryId',v_entry),'revisions',jsonb_build_object(v_plan::text,v_plan_rev,v_household::text,v_house_rev));
  perform app_private.complete_command(v_op,v_result); return v_result;
end $$;

create or replace function public.swap_meals(p_command jsonb)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare p jsonb:=p_command->'payload'; v_replay jsonb; v_household uuid:=(p->>'householdId')::uuid; v_plan uuid:=(p->>'planId')::uuid; v_first uuid:=(p->>'firstEntryId')::uuid; v_second uuid:=(p->>'secondEntryId')::uuid; v_plan_rev integer; v_old record; v_a public.meal_entries%rowtype; v_b public.meal_entries%rowtype; v_ids uuid[]; v_before jsonb; v_after jsonb; v_change uuid; v_new_plan integer; v_house_rev integer; v_op uuid:=(p_command->>'operationId')::uuid; v_result jsonb;
begin
  v_replay:=app_private.claim_command('swap_meals',p_command); if v_replay is not null then return v_replay; end if;
  perform app_private.assert_role(v_household,array['owner','editor']);
  select revision into v_plan_rev from public.plans where id=v_plan and household_id=v_household and status='active' for update;
  if not found then perform app_private.fail('NOT_FOUND'); end if; perform app_private.assert_revision(p_command,v_plan,v_plan_rev);
  select * into v_a from public.meal_entries where id=v_first and household_id=v_household and plan_id=v_plan for update;
  select * into v_b from public.meal_entries where id=v_second and household_id=v_household and plan_id=v_plan for update;
  if v_a.id is null or v_b.id is null or v_a.id=v_b.id then perform app_private.fail('FOREIGN_ID'); end if;
  v_ids:=array[v_a.id,v_b.id]; v_before:=app_private.capture_plan_state(v_plan,v_ids);
  update public.meal_entries set entry_date=case id when v_a.id then v_b.entry_date else v_a.entry_date end,slot=case id when v_a.id then v_b.slot else v_a.slot end,revision=revision+1 where id=any(v_ids);
  update public.planned_batches b set cook_date=case when b.id=v_a.batch_id and v_a.entry_date=b.cook_date then v_b.entry_date when b.id=v_b.batch_id and v_b.entry_date=b.cook_date then v_a.entry_date else b.cook_date end,revision=revision+1 where b.id in (v_a.batch_id,v_b.batch_id) and (b.id=v_a.batch_id and v_a.entry_date=b.cook_date or b.id=v_b.batch_id and v_b.entry_date=b.cook_date);
  update public.prep_reminders set reminder_date=case when entry_id=v_a.id then reminder_date+(v_b.entry_date-v_a.entry_date) when entry_id=v_b.id then reminder_date+(v_a.entry_date-v_b.entry_date) else reminder_date end,revision=revision+1 where entry_id=any(v_ids);
  if exists(select 1 from public.meal_entries e join public.planned_batches b on b.id=e.batch_id where e.plan_id=v_plan and e.entry_date<b.cook_date) then perform app_private.fail('REST_BEFORE_COOK'); end if;
  v_after:=app_private.capture_plan_state(v_plan,v_ids);
  update public.plans set revision=revision+1 where id=v_plan returning revision into v_new_plan;
  update public.households set plan_revision=plan_revision+1 where id=v_household returning plan_revision into v_house_rev;
  insert into public.plan_changes(household_id,plan_id,operation_id,change_kind,affected_entry_ids,before_dates,after_dates,resulting_revision) values(v_household,v_plan,v_op,'swap',v_ids,v_before,v_after,v_new_plan) returning id into v_change;
  v_result:=jsonb_build_object('operationId',v_op,'replayed',false,'result',jsonb_build_object('changeId',v_change,'planId',v_plan,'entryIds',to_jsonb(v_ids)),'revisions',jsonb_build_object(v_plan::text,v_new_plan,v_household::text,v_house_rev));
  perform app_private.complete_command(v_op,v_result); return v_result;
end $$;

create or replace function public.move_plan(p_command jsonb)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare p jsonb:=p_command->'payload'; v_replay jsonb; v_household uuid:=(p->>'householdId')::uuid; v_plan uuid:=(p->>'planId')::uuid; v_scope text:=coalesce(p->>'scope','selected'); v_days integer; v_ids uuid[]; v_initial uuid[]; v_min date; v_plan_rev integer; v_before jsonb; v_after jsonb; v_new_plan integer; v_house_rev integer; v_change uuid; v_op uuid:=(p_command->>'operationId')::uuid; v_result jsonb; v_given integer;
begin
  v_replay:=app_private.claim_command('move_plan',p_command); if v_replay is not null then return v_replay; end if;
  perform app_private.assert_role(v_household,array['owner','editor']);
  begin v_days:=(p->>'days')::integer; exception when others then perform app_private.fail('VALIDATION'); end;
  if v_days=0 or v_days not between -365 and 365 or v_scope not in ('selected','following') or jsonb_typeof(p->'entryIds')<>'array' then perform app_private.fail('VALIDATION'); end if;
  select array_agg((value#>>'{}')::uuid) into v_initial from jsonb_array_elements(p->'entryIds');
  if coalesce(array_length(v_initial,1),0)=0 then perform app_private.fail('VALIDATION'); end if;
  select revision into v_plan_rev from public.plans where id=v_plan and household_id=v_household and status='active' for update;
  if not found then perform app_private.fail('NOT_FOUND'); end if; perform app_private.assert_revision(p_command,v_plan,v_plan_rev);
  select min(entry_date) into v_min from public.meal_entries where id=any(v_initial) and household_id=v_household and plan_id=v_plan and archived_at is null;
  select count(*) into v_given from public.meal_entries where id=any(v_initial) and household_id=v_household and plan_id=v_plan and archived_at is null;
  if v_given<>array_length(v_initial,1) then perform app_private.fail('FOREIGN_ID'); end if;
  if v_scope='following' then
    select array_agg(id order by entry_date,slot,id) into v_ids from public.meal_entries where household_id=v_household and plan_id=v_plan and entry_date>=v_min and archived_at is null;
  else v_ids:=v_initial; end if;
  v_before:=app_private.capture_plan_state(v_plan,v_ids);
  update public.meal_entries set entry_date=entry_date+v_days,revision=revision+1 where id=any(v_ids) and archived_at is null;
  update public.planned_batches b set cook_date=cook_date+v_days,revision=revision+1 where b.plan_id=v_plan and exists(select 1 from public.meal_entries e where e.batch_id=b.id and e.id=any(v_ids) and e.archived_at is null and (e.entry_date-v_days)=b.cook_date);
  update public.prep_reminders r set reminder_date=reminder_date+v_days,revision=revision+1 where r.entry_id=any(v_ids) or r.batch_id in (select b.id from public.planned_batches b where b.plan_id=v_plan and exists(select 1 from public.meal_entries e where e.batch_id=b.id and e.id=any(v_ids)));
  if exists(select 1 from public.meal_entries e join public.planned_batches b on b.id=e.batch_id where e.plan_id=v_plan and e.archived_at is null and e.entry_date<b.cook_date) then perform app_private.fail('REST_BEFORE_COOK'); end if;
  v_after:=app_private.capture_plan_state(v_plan,v_ids);
  update public.plans p0 set start_date=least(p0.start_date,(select min(entry_date) from public.meal_entries where plan_id=v_plan)),end_date=greatest(p0.end_date,(select max(entry_date) from public.meal_entries where plan_id=v_plan)),revision=revision+1 where p0.id=v_plan returning revision into v_new_plan;
  update public.households set plan_revision=plan_revision+1 where id=v_household returning plan_revision into v_house_rev;
  insert into public.plan_changes(household_id,plan_id,operation_id,change_kind,affected_entry_ids,before_dates,after_dates,resulting_revision) values(v_household,v_plan,v_op,'move',v_ids,v_before,v_after,v_new_plan) returning id into v_change;
  v_result:=jsonb_build_object('operationId',v_op,'replayed',false,'result',jsonb_build_object('changeId',v_change,'planId',v_plan,'entryIds',to_jsonb(v_ids)),'revisions',jsonb_build_object(v_plan::text,v_new_plan,v_household::text,v_house_rev));
  perform app_private.complete_command(v_op,v_result); return v_result;
end $$;

create or replace function public.undo_plan_change(p_command jsonb)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare p jsonb:=p_command->'payload'; v_replay jsonb; v_household uuid:=(p->>'householdId')::uuid; v_change uuid:=(p->>'changeId')::uuid; v_plan uuid; v_op uuid:=(p_command->>'operationId')::uuid; v_plan_rev integer; v_row public.plan_changes%rowtype; v_item jsonb; v_new_plan integer; v_house_rev integer; v_result jsonb;
begin
  v_replay:=app_private.claim_command('undo_plan_change',p_command); if v_replay is not null then return v_replay; end if;
  select * into v_row from public.plan_changes where id=v_change and household_id=v_household for update;
  if not found then perform app_private.fail('NOT_FOUND'); end if; v_plan:=v_row.plan_id;
  perform app_private.assert_role(v_household,array['owner','editor']);
  select revision into v_plan_rev from public.plans where id=v_plan and household_id=v_household for update;
  perform app_private.assert_revision(p_command,v_plan,v_plan_rev);
  if v_row.undone_at is not null or v_plan_rev<>v_row.resulting_revision then perform app_private.fail('REVISION_CONFLICT'); end if;
  for v_item in select value from jsonb_array_elements(v_row.before_dates->'entries') loop
    update public.meal_entries set entry_date=(v_item->>'date')::date,slot=v_item->>'slot',revision=revision+1 where id=(v_item->>'id')::uuid and household_id=v_household;
  end loop;
  for v_item in select value from jsonb_array_elements(v_row.before_dates->'batches') loop
    update public.planned_batches set cook_date=(v_item->>'cookDate')::date,revision=revision+1 where id=(v_item->>'id')::uuid and household_id=v_household;
  end loop;
  for v_item in select value from jsonb_array_elements(v_row.before_dates->'reminders') loop
    update public.prep_reminders set reminder_date=(v_item->>'date')::date,revision=revision+1 where id=(v_item->>'id')::uuid and household_id=v_household;
  end loop;
  if exists(select 1 from public.meal_entries e join public.planned_batches b on b.id=e.batch_id where e.plan_id=v_plan and e.entry_date<b.cook_date) then perform app_private.fail('REST_BEFORE_COOK'); end if;
  update public.plan_changes set undone_at=now(),undone_by=auth.uid(),undo_operation_id=v_op where id=v_change;
  update public.plans set revision=revision+1 where id=v_plan returning revision into v_new_plan;
  update public.households set plan_revision=plan_revision+1 where id=v_household returning plan_revision into v_house_rev;
  v_result:=jsonb_build_object('operationId',v_op,'replayed',false,'result',jsonb_build_object('changeId',v_change,'planId',v_plan,'undone',true),'revisions',jsonb_build_object(v_plan::text,v_new_plan,v_household::text,v_house_rev));
  perform app_private.complete_command(v_op,v_result); return v_result;
end $$;

create or replace function public.create_draft(p_command jsonb)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare p jsonb:=p_command->'payload'; v_replay jsonb; v_household uuid:=(p->>'householdId')::uuid; v_plan uuid:=(p->>'planId')::uuid; v_plan_revision integer; v_draft uuid; v_entry jsonb; v_entry_id uuid; v_alloc jsonb; v_op uuid:=(p_command->>'operationId')::uuid; v_result jsonb; v_kind text; v_recipe uuid; v_food uuid;
begin
  v_replay:=app_private.claim_command('create_draft',p_command); if v_replay is not null then return v_replay; end if;
  perform app_private.assert_role(v_household,array['owner','editor']);
  select revision into v_plan_revision from public.plans where id=v_plan and household_id=v_household for update; if not found then perform app_private.fail('NOT_FOUND'); end if;
  perform app_private.assert_revision(p_command,v_plan,v_plan_revision); perform app_private.assert_new_revision(p_command,'newDraft');
  insert into public.plan_drafts(household_id,plan_id,title,created_by) values(v_household,v_plan,coalesce(nullif(p->>'title',''),'Entwurf'),auth.uid()) returning id into v_draft;
  for v_entry in select value from jsonb_array_elements(coalesce(p->'entries','[]'::jsonb)) loop
    v_kind:=v_entry->>'kind'; v_recipe:=nullif(v_entry->>'recipeVersionId','')::uuid; v_food:=nullif(v_entry->>'foodVersionId','')::uuid;
    if v_kind='recipe' then
      if not exists(select 1 from public.recipe_versions where id=v_recipe and household_id=v_household) then perform app_private.fail('FOREIGN_ID'); end if;
    elsif v_kind='food' then perform app_private.assert_food_scope(v_food,v_household);
    elsif v_kind<>'flex' then perform app_private.fail('VALIDATION'); end if;
    insert into public.draft_entries(household_id,draft_id,entry_date,slot,entry_kind,recipe_version_id,food_version_id,recipe_cook_portions,replaces_entry_id,label,quantity_g,replacement_required,replacement_resolved)
    values(v_household,v_draft,app_private.assert_date(v_entry->>'date'),v_entry->>'slot',v_kind,v_recipe,v_food,nullif(v_entry->>'cookPortions','')::numeric,nullif(v_entry->>'replacesEntryId','')::uuid,nullif(v_entry->>'label',''),nullif(v_entry->>'quantityG','')::numeric,coalesce((v_entry->>'replacementRequired')::boolean,false),coalesce((v_entry->>'replacementResolved')::boolean,true)) returning id into v_entry_id;
    for v_alloc in select value from jsonb_array_elements(coalesce(v_entry->'allocations','[]'::jsonb)) loop
      insert into public.draft_allocations(household_id,draft_entry_id,person_id,portions) values(v_household,v_entry_id,(v_alloc->>'personId')::uuid,(v_alloc->>'portions')::numeric);
    end loop;
  end loop;
  v_result:=jsonb_build_object('operationId',v_op,'replayed',false,'result',jsonb_build_object('draftId',v_draft,'planId',v_plan,'revision',1),'revisions',jsonb_build_object(v_draft::text,1));
  perform app_private.complete_command(v_op,v_result); return v_result;
end $$;

create or replace function public.replace_draft_entry(p_command jsonb)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare p jsonb:=p_command->'payload'; v_replay jsonb; v_household uuid:=(p->>'householdId')::uuid; v_draft uuid:=(p->>'draftId')::uuid; v_entry uuid:=(p->>'entryId')::uuid; v_draft_revision integer; v_draft_row public.plan_drafts%rowtype; v_choice jsonb:=p->'choice'; v_kind text:=p->'choice'->>'kind'; v_recipe uuid:=nullif(p->'choice'->>'recipeVersionId','')::uuid; v_food uuid:=nullif(p->'choice'->>'foodVersionId','')::uuid; v_new_revision integer; v_op uuid:=(p_command->>'operationId')::uuid; v_result jsonb;
begin
  v_replay:=app_private.claim_command('replace_draft_entry',p_command); if v_replay is not null then return v_replay; end if;
  perform app_private.assert_role(v_household,array['owner','editor']);
  select * into v_draft_row from public.plan_drafts where id=v_draft and household_id=v_household for update; if not found or v_draft_row.status<>'open' then perform app_private.fail('NOT_FOUND'); end if;
  perform app_private.assert_revision(p_command,v_draft,v_draft_row.revision);
  if not exists(select 1 from public.draft_entries where id=v_entry and household_id=v_household and draft_id=v_draft) then perform app_private.fail('NOT_FOUND'); end if;
  if v_kind='recipe' then
    if not exists(select 1 from public.recipe_versions where id=v_recipe and household_id=v_household) then perform app_private.fail('FOREIGN_ID'); end if;
  elsif v_kind='food' then perform app_private.assert_food_scope(v_food,v_household);
  elsif v_kind<>'flex' then perform app_private.fail('VALIDATION'); end if;
  update public.draft_entries set entry_kind=v_kind,recipe_version_id=v_recipe,food_version_id=v_food,recipe_cook_portions=nullif(v_choice->>'cookPortions','')::numeric,label=nullif(v_choice->>'label',''),quantity_g=nullif(v_choice->>'quantityG','')::numeric,replaces_entry_id=nullif(p->>'replacesEntryId','')::uuid,replacement_resolved=not coalesce((p->>'clearReplacement')::boolean,false),revision=revision+1 where id=v_entry;
  if p ? 'allocations' then
    delete from public.draft_allocations where draft_entry_id=v_entry;
    insert into public.draft_allocations(household_id,draft_entry_id,person_id,portions)
    select v_household,v_entry,(x->>'personId')::uuid,(x->>'portions')::numeric from jsonb_array_elements(p->'allocations') x;
  end if;
  update public.plan_drafts set revision=revision+1 where id=v_draft returning revision into v_new_revision;
  v_result:=jsonb_build_object('operationId',v_op,'replayed',false,'result',jsonb_build_object('draftId',v_draft,'entryId',v_entry),'revisions',jsonb_build_object(v_draft::text,v_new_revision));
  perform app_private.complete_command(v_op,v_result); return v_result;
end $$;

create or replace function public.approve_draft(p_command jsonb)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare p jsonb:=p_command->'payload'; v_replay jsonb; v_household uuid:=(p->>'householdId')::uuid; v_draft uuid:=(p->>'draftId')::uuid; v_plan uuid:=(p->>'planId')::uuid; v_draft_row public.plan_drafts%rowtype; v_plan_revision integer; v_entry public.draft_entries%rowtype; v_alloc jsonb; v_batch uuid; v_meal uuid; v_alloc_total numeric; v_recipe uuid; v_new_plan integer; v_new_draft integer; v_house_rev integer; v_op uuid:=(p_command->>'operationId')::uuid; v_result jsonb; v_existing_date date; v_existing_plan uuid;
begin
  v_replay:=app_private.claim_command('approve_draft',p_command); if v_replay is not null then return v_replay; end if;
  perform app_private.assert_role(v_household,array['owner','editor']);
  select * into v_draft_row from public.plan_drafts where id=v_draft and household_id=v_household for update; if not found or v_draft_row.status<>'open' or v_draft_row.plan_id<>v_plan then perform app_private.fail('NOT_FOUND'); end if;
  select revision into v_plan_revision from public.plans where id=v_plan and household_id=v_household and status='active' for update; if not found then perform app_private.fail('NOT_FOUND'); end if;
  perform app_private.assert_revision(p_command,v_draft,v_draft_row.revision); perform app_private.assert_revision(p_command,v_plan,v_plan_revision);
  if exists(select 1 from public.draft_entries where draft_id=v_draft and replacement_required and not replacement_resolved and (not coalesce((p->>'acceptUnresolvedFlex')::boolean,false) or entry_kind<>'flex')) then perform app_private.fail('DRAFT_REPLACEMENTS_UNRESOLVED'); end if;
  for v_entry in select * from public.draft_entries where draft_id=v_draft order by entry_date,slot,id for update loop
    if v_entry.replaces_entry_id is not null then
      select plan_id,batch_id into v_existing_plan,v_batch from public.meal_entries where id=v_entry.replaces_entry_id and household_id=v_household and archived_at is null for update;
      if not found or v_existing_plan<>v_plan then perform app_private.fail('FOREIGN_ID'); end if;
      update public.meal_entries set archived_at=now(),revision=revision+1 where id=v_entry.replaces_entry_id;
    end if;
    if v_entry.entry_kind='recipe' then
      v_recipe:=v_entry.recipe_version_id;
      insert into public.planned_batches(household_id,plan_id,recipe_version_id,cook_date,cook_portions) values(v_household,v_plan,v_recipe,v_entry.entry_date,v_entry.recipe_cook_portions) returning id into v_batch;
      insert into public.meal_entries(household_id,plan_id,entry_date,slot,entry_kind,batch_id) values(v_household,v_plan,v_entry.entry_date,v_entry.slot,'recipe_batch',v_batch) returning id into v_meal;
      select coalesce(sum(portions),0) into v_alloc_total from public.draft_allocations where draft_entry_id=v_entry.id;
      if v_alloc_total>v_entry.recipe_cook_portions then perform app_private.fail('ALLOCATION_LIMIT'); end if;
      insert into public.meal_allocations(household_id,entry_id,person_id,portions) select v_household,v_meal,person_id,portions from public.draft_allocations where draft_entry_id=v_entry.id;
    elsif v_entry.entry_kind='food' then
      insert into public.meal_entries(household_id,plan_id,entry_date,slot,entry_kind,food_version_id,label,quantity_g) values(v_household,v_plan,v_entry.entry_date,v_entry.slot,'direct_food',v_entry.food_version_id,v_entry.label,v_entry.quantity_g) returning id into v_meal;
      insert into public.meal_allocations(household_id,entry_id,person_id,portions) select v_household,v_meal,person_id,portions from public.draft_allocations where draft_entry_id=v_entry.id;
    else
      insert into public.meal_entries(household_id,plan_id,entry_date,slot,entry_kind,label) values(v_household,v_plan,v_entry.entry_date,v_entry.slot,'flex',v_entry.label) returning id into v_meal;
      insert into public.meal_allocations(household_id,entry_id,person_id,portions) select v_household,v_meal,person_id,portions from public.draft_allocations where draft_entry_id=v_entry.id;
    end if;
  end loop;
  update public.plan_drafts set status='approved',approved_at=now(),revision=revision+1 where id=v_draft returning revision into v_new_draft;
  update public.plans set revision=revision+1 where id=v_plan returning revision into v_new_plan;
  update public.households set plan_revision=plan_revision+1 where id=v_household returning plan_revision into v_house_rev;
  v_result:=jsonb_build_object('operationId',v_op,'replayed',false,'result',jsonb_build_object('draftId',v_draft,'planId',v_plan,'approved',true),'revisions',jsonb_build_object(v_draft::text,v_new_draft,v_plan::text,v_new_plan,v_household::text,v_house_rev));
  perform app_private.complete_command(v_op,v_result); return v_result;
end $$;

create or replace function public.set_checklist_item(p_command jsonb)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare p jsonb:=p_command->'payload'; v_replay jsonb; v_household uuid:=(p->>'householdId')::uuid; v_batch uuid:=(p->>'batchId')::uuid; v_kind text:=p->>'itemKind'; v_key text:=p->>'itemKey'; v_revision integer; v_exists boolean; v_checked boolean:=(p->>'checked')::boolean; v_op uuid:=(p_command->>'operationId')::uuid; v_new integer; v_result jsonb;
begin
  v_replay:=app_private.claim_command('set_checklist_item',p_command); if v_replay is not null then return v_replay; end if;
  perform app_private.assert_role(v_household,array['owner','editor']);
  select revision into v_revision from public.planned_batches where id=v_batch and household_id=v_household for update; if not found then perform app_private.fail('NOT_FOUND'); end if;
  perform app_private.assert_revision(p_command,v_batch,v_revision);
  if v_kind='ingredient' then
    if not exists(select 1 from public.planned_batches b join public.recipe_ingredients i on i.recipe_version_id=b.recipe_version_id where b.id=v_batch and i.id::text=v_key) then perform app_private.fail('NOT_FOUND'); end if;
  elsif v_kind='step' then
    if not v_key ~ '^[0-9]+$' or not exists(select 1 from public.planned_batches b join public.recipe_versions r on r.id=b.recipe_version_id join lateral jsonb_array_elements(r.steps) with ordinality s(value,ordinality) on true where b.id=v_batch and coalesce(s.value->>'position',(s.ordinality-1)::text)=v_key) then perform app_private.fail('NOT_FOUND'); end if;
  else perform app_private.fail('VALIDATION'); end if;
  insert into public.cooking_checklist_items(household_id,batch_id,item_kind,item_key,checked,checked_by,checked_at)
  values(v_household,v_batch,v_kind,v_key,v_checked,case when v_checked then auth.uid() else null end,case when v_checked then now() else null end)
  on conflict(batch_id,item_kind,item_key) do update set checked=excluded.checked,checked_by=excluded.checked_by,checked_at=excluded.checked_at,revision=public.cooking_checklist_items.revision+1 returning revision into v_new;
  update public.planned_batches set revision=revision+1 where id=v_batch returning revision into v_revision;
  v_result:=jsonb_build_object('operationId',v_op,'replayed',false,'result',jsonb_build_object('batchId',v_batch,'itemKind',v_kind,'itemKey',v_key,'checked',v_checked),'revisions',jsonb_build_object(v_batch::text,v_revision));
  perform app_private.complete_command(v_op,v_result); return v_result;
end $$;

create or replace function public.set_prep_reminder(p_command jsonb)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare p jsonb:=p_command->'payload'; v_replay jsonb; v_household uuid:=(p->>'householdId')::uuid; v_reminder uuid:=nullif(p->>'reminderId','')::uuid; v_entry uuid:=nullif(p->>'entryId','')::uuid; v_batch uuid:=nullif(p->>'batchId','')::uuid; v_revision integer; v_new integer; v_op uuid:=(p_command->>'operationId')::uuid; v_result jsonb;
begin
  v_replay:=app_private.claim_command('set_prep_reminder',p_command); if v_replay is not null then return v_replay; end if;
  perform app_private.assert_role(v_household,array['owner','editor']);
  if (v_entry is null)=(v_batch is null) then perform app_private.fail('VALIDATION'); end if;
  if v_entry is not null and not exists(select 1 from public.meal_entries where id=v_entry and household_id=v_household) then perform app_private.fail('FOREIGN_ID'); end if;
  if v_batch is not null and not exists(select 1 from public.planned_batches where id=v_batch and household_id=v_household) then perform app_private.fail('FOREIGN_ID'); end if;
  if v_reminder is null then
    perform app_private.assert_new_revision(p_command);
    insert into public.prep_reminders(household_id,entry_id,batch_id,reminder_date,text,done) values(v_household,v_entry,v_batch,app_private.assert_date(p->>'date'),btrim(p->>'text'),coalesce((p->>'done')::boolean,false)) returning id,revision into v_reminder,v_new;
  else
    select revision into v_revision from public.prep_reminders where id=v_reminder and household_id=v_household for update; if not found then perform app_private.fail('NOT_FOUND'); end if;
    perform app_private.assert_revision(p_command,v_reminder,v_revision);
    update public.prep_reminders set entry_id=v_entry,batch_id=v_batch,reminder_date=app_private.assert_date(p->>'date'),text=btrim(p->>'text'),done=coalesce((p->>'done')::boolean,false),revision=revision+1 where id=v_reminder returning revision into v_new;
  end if;
  v_result:=jsonb_build_object('operationId',v_op,'replayed',false,'result',jsonb_build_object('reminderId',v_reminder),'revisions',jsonb_build_object(v_reminder::text,v_new));
  perform app_private.complete_command(v_op,v_result); return v_result;
end $$;

create or replace function public.mark_batch_cooked(p_command jsonb)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare p jsonb:=p_command->'payload'; v_replay jsonb; v_household uuid:=(p->>'householdId')::uuid; v_batch uuid:=(p->>'batchId')::uuid; v_plan uuid; v_batch_rev integer; v_plan_rev integer; v_new_batch integer; v_new_plan integer; v_house_rev integer; v_op uuid:=(p_command->>'operationId')::uuid; v_result jsonb;
begin
  v_replay:=app_private.claim_command('mark_batch_cooked',p_command); if v_replay is not null then return v_replay; end if;
  perform app_private.assert_role(v_household,array['owner','editor']);
  select plan_id,revision into v_plan,v_batch_rev from public.planned_batches where id=v_batch and household_id=v_household for update; if not found then perform app_private.fail('NOT_FOUND'); end if;
  select revision into v_plan_rev from public.plans where id=v_plan and household_id=v_household for update;
  perform app_private.assert_revision(p_command,v_batch,v_batch_rev); perform app_private.assert_revision(p_command,v_plan,v_plan_rev);
  update public.planned_batches set completed=true,completed_at=coalesce(completed_at,now()),inventory_review_required=true,revision=revision+1 where id=v_batch returning revision into v_new_batch;
  update public.inventory_items i set needs_review=true,status='stale',revision=revision+1
  where i.household_id=v_household and exists(select 1 from public.planned_batches b join public.recipe_ingredients ri on ri.recipe_version_id=b.recipe_version_id join public.foods f on f.id=(select food_id from public.food_versions where id=ri.food_version_id) where b.id=v_batch and (i.food_version_id=ri.food_version_id or i.compatibility_key is not null and i.compatibility_key=f.compatibility_key));
  update public.plans set revision=revision+1 where id=v_plan returning revision into v_new_plan;
  update public.households set inventory_revision=inventory_revision+1,plan_revision=plan_revision+1 where id=v_household returning plan_revision into v_house_rev;
  v_result:=jsonb_build_object('operationId',v_op,'replayed',false,'result',jsonb_build_object('batchId',v_batch,'completed',true,'inventoryNeedsReview',true),'revisions',jsonb_build_object(v_batch::text,v_new_batch,v_plan::text,v_new_plan,v_household::text,v_house_rev));
  perform app_private.complete_command(v_op,v_result); return v_result;
end $$;

create or replace function public.mark_direct_food_provided(p_command jsonb)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare p jsonb:=p_command->'payload'; v_replay jsonb; v_household uuid:=(p->>'householdId')::uuid; v_entry uuid:=(p->>'entryId')::uuid; v_plan uuid; v_entry_rev integer; v_plan_rev integer; v_food uuid; v_new_entry integer; v_new_plan integer; v_house_rev integer; v_op uuid:=(p_command->>'operationId')::uuid; v_result jsonb;
begin
  v_replay:=app_private.claim_command('mark_direct_food_provided',p_command); if v_replay is not null then return v_replay; end if;
  perform app_private.assert_role(v_household,array['owner','editor']);
  select plan_id,food_version_id,revision into v_plan,v_food,v_entry_rev from public.meal_entries where id=v_entry and household_id=v_household and entry_kind='direct_food' for update; if not found then perform app_private.fail('NOT_FOUND'); end if;
  select revision into v_plan_rev from public.plans where id=v_plan and household_id=v_household for update;
  perform app_private.assert_revision(p_command,v_entry,v_entry_rev); perform app_private.assert_revision(p_command,v_plan,v_plan_rev);
  update public.meal_entries set provided=true,inventory_review_required=true,revision=revision+1 where id=v_entry returning revision into v_new_entry;
  update public.inventory_items i set needs_review=true,status='stale',revision=revision+1 where i.household_id=v_household and (i.food_version_id=v_food or i.compatibility_key=(select f.compatibility_key from public.food_versions v join public.foods f on f.id=v.food_id where v.id=v_food));
  update public.plans set revision=revision+1 where id=v_plan returning revision into v_new_plan;
  update public.households set inventory_revision=inventory_revision+1,plan_revision=plan_revision+1 where id=v_household returning plan_revision into v_house_rev;
  v_result:=jsonb_build_object('operationId',v_op,'replayed',false,'result',jsonb_build_object('entryId',v_entry,'provided',true,'inventoryNeedsReview',true),'revisions',jsonb_build_object(v_entry::text,v_new_entry,v_plan::text,v_new_plan,v_household::text,v_house_rev));
  perform app_private.complete_command(v_op,v_result); return v_result;
end $$;

create or replace function public.save_feedback(p_command jsonb)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare p jsonb:=p_command->'payload'; v_replay jsonb; v_household uuid:=(p->>'householdId')::uuid; v_feedback uuid:=nullif(p->>'feedbackId','')::uuid; v_op uuid:=(p_command->>'operationId')::uuid; v_revision integer; v_new_revision integer; v_recipe uuid:=nullif(p->>'recipeId','')::uuid; v_version uuid:=nullif(p->>'recipeVersionId','')::uuid; v_entry uuid:=nullif(p->>'entryId','')::uuid; v_person uuid:=nullif(p->>'personId',''); v_result jsonb;
begin
  v_replay:=app_private.claim_command('save_feedback',p_command); if v_replay is not null then return v_replay; end if;
  perform app_private.assert_role(v_household,array['owner','editor']);
  if v_feedback is null then
    perform app_private.assert_new_revision(p_command);
    insert into public.feedback(household_id,recipe_id,recipe_version_id,meal_entry_id,person_id,rating,note,wish,created_by)
    values(v_household,v_recipe,v_version,v_entry,v_person,nullif(p->>'rating','')::smallint,nullif(p->>'note',''),nullif(p->>'wish',''),auth.uid()) returning id,revision into v_feedback,v_new_revision;
  else
    select revision into v_revision from public.feedback where id=v_feedback and household_id=v_household for update; if not found then perform app_private.fail('NOT_FOUND'); end if;
    perform app_private.assert_revision(p_command,v_feedback,v_revision);
    update public.feedback set recipe_id=v_recipe,recipe_version_id=v_version,meal_entry_id=v_entry,person_id=v_person,rating=nullif(p->>'rating','')::smallint,note=nullif(p->>'note',''),wish=nullif(p->>'wish',''),revision=revision+1 where id=v_feedback returning revision into v_new_revision;
  end if;
  v_result:=jsonb_build_object('operationId',v_op,'replayed',false,'result',jsonb_build_object('feedbackId',v_feedback),'revisions',jsonb_build_object(v_feedback::text,v_new_revision));
  perform app_private.complete_command(v_op,v_result); return v_result;
end $$;

create or replace function public.set_plan_day_completeness(p_command jsonb)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  p jsonb:=p_command->'payload';
  v_replay jsonb;
  v_household uuid:=(p->>'householdId')::uuid;
  v_date date:=app_private.assert_date(p->>'date');
  v_complete boolean;
  v_revision integer;
  v_new_revision integer;
  v_op uuid:=(p_command->>'operationId')::uuid;
  v_result jsonb;
begin
  v_replay:=app_private.claim_command('set_plan_day_completeness',p_command); if v_replay is not null then return v_replay; end if;
  perform app_private.assert_role(v_household,array['owner','editor']);
  if jsonb_typeof(p->'complete') is distinct from 'boolean' then perform app_private.fail('VALIDATION'); end if;
  v_complete:=(p->>'complete')::boolean;
  select plan_revision into v_revision from public.households where id=v_household for update; if not found then perform app_private.fail('NOT_FOUND'); end if;
  perform app_private.assert_revision(p_command,v_household,v_revision);
  insert into public.plan_day_completeness(household_id,complete_on,complete,completed_by,completed_at)
  values(v_household,v_date,v_complete,case when v_complete then auth.uid() else null end,case when v_complete then now() else null end)
  on conflict(household_id,complete_on) do update
  set complete=excluded.complete,completed_by=excluded.completed_by,completed_at=excluded.completed_at,revision=public.plan_day_completeness.revision+1;
  update public.households set plan_revision=plan_revision+1 where id=v_household returning plan_revision into v_new_revision;
  v_result:=jsonb_build_object('operationId',v_op,'replayed',false,'result',jsonb_build_object('date',v_date,'complete',v_complete),'revisions',jsonb_build_object(v_household::text,v_new_revision));
  perform app_private.complete_command(v_op,v_result); return v_result;
end $$;

grant execute on function public.schedule_batch(jsonb),public.allocate_meal(jsonb),public.schedule_direct_food(jsonb),public.swap_meals(jsonb),public.move_plan(jsonb),public.undo_plan_change(jsonb),public.create_draft(jsonb),public.replace_draft_entry(jsonb),public.approve_draft(jsonb),public.set_checklist_item(jsonb),public.set_plan_day_completeness(jsonb),public.set_prep_reminder(jsonb),public.mark_batch_cooked(jsonb),public.mark_direct_food_provided(jsonb),public.save_feedback(jsonb) to authenticated;
