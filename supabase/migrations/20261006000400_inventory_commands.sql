create or replace function public.save_inventory_status(p_command jsonb)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare p jsonb:=p_command->'payload'; v_replay jsonb; v_household uuid:=(p->>'householdId')::uuid; v_item uuid:=nullif(p->>'itemId','')::uuid; v_food uuid:=nullif(p->>'foodVersionId','')::uuid; v_qty numeric:=nullif(p->>'quantity','')::numeric; v_status text:=coalesce(p->>'status','unknown'); v_qual text:=coalesce(p->>'qualitativeState','unknown'); v_unit text:=coalesce(p->>'unit','unknown'); v_basis text:=coalesce(p->>'amountBasis','unknown'); v_old public.inventory_items%rowtype; v_revision integer; v_new_revision integer; v_delta numeric; v_op uuid:=(p_command->>'operationId')::uuid; v_result jsonb;
begin
  v_replay:=app_private.claim_command('save_inventory_status',p_command); if v_replay is not null then return v_replay; end if;
  perform app_private.assert_role(v_household,array['owner','editor']);
  if v_status not in ('confirmed','qualitative','unknown','stale') or v_qual not in ('present','low','unknown') or v_basis not in ('edible','purchase','drained','unknown') then perform app_private.fail('VALIDATION'); end if;
  if v_food is not null then perform app_private.assert_food_scope(v_food,v_household); elsif nullif(btrim(p->>'freeText'),'') is null then perform app_private.fail('VALIDATION'); end if;
  if v_qty is not null and (not public.numeric_is_finite(v_qty) or v_qty<0) then perform app_private.fail('VALIDATION'); end if;
  if v_item is null then
    perform app_private.assert_new_revision(p_command);
    if v_status='confirmed' and v_qty is null then perform app_private.fail('VALIDATION'); end if;
    insert into public.inventory_items(household_id,food_version_id,compatibility_key,free_text,quantity,unit,amount_basis,grams_per_unit,qualitative_state,storage_location,status,needs_review,confirmed_at,confirmed_revision)
    values(v_household,v_food,nullif(p->>'compatibilityKey',''),nullif(btrim(p->>'freeText'),''),v_qty,v_unit,v_basis,nullif(p->>'gramsPerUnit','')::numeric,v_qual,nullif(p->>'storageLocation',''),v_status,false,case when v_status='confirmed' then now() else null end,case when v_status='confirmed' then 1 else null end) returning id,revision into v_item,v_new_revision;
    if v_status='confirmed' then
      insert into public.inventory_movements(household_id,inventory_item_id,delta,quantity_after,unit,reason,note,actor_user_id,operation_id) values(v_household,v_item,v_qty,v_qty,v_unit,'correction','Opening balance confirmed',auth.uid(),v_op);
    end if;
  else
    select * into v_old from public.inventory_items where id=v_item and household_id=v_household for update; if not found then perform app_private.fail('NOT_FOUND'); end if;
    perform app_private.assert_revision(p_command,v_item,v_old.revision);
    if v_qty is not null and v_qty is distinct from v_old.quantity then perform app_private.fail('INVENTORY_MOVEMENT_REQUIRED'); end if;
    if v_old.quantity is not null and v_unit is distinct from v_old.unit then perform app_private.fail('INCOMPATIBLE_UNIT'); end if;
    if coalesce((p->>'confirmCurrentBalance')::boolean,false) and v_old.quantity is null then perform app_private.fail('QUANTITY_UNKNOWN'); end if;
    update public.inventory_items set food_version_id=coalesce(v_food,food_version_id),compatibility_key=case when p ? 'compatibilityKey' then nullif(p->>'compatibilityKey','') else compatibility_key end,free_text=case when p ? 'freeText' then nullif(btrim(p->>'freeText'),'') else free_text end,unit=v_unit,amount_basis=v_basis,grams_per_unit=case when p ? 'gramsPerUnit' then nullif(p->>'gramsPerUnit','')::numeric else grams_per_unit end,qualitative_state=v_qual,storage_location=case when p ? 'storageLocation' then nullif(p->>'storageLocation','') else storage_location end,status=case when coalesce((p->>'confirmCurrentBalance')::boolean,false) then 'confirmed' else v_status end,needs_review=case when coalesce((p->>'confirmCurrentBalance')::boolean,false) then false else needs_review end,confirmed_at=case when coalesce((p->>'confirmCurrentBalance')::boolean,false) then now() else confirmed_at end,revision=revision+1 where id=v_item returning revision into v_new_revision;
    if coalesce((p->>'confirmCurrentBalance')::boolean,false) then
      insert into public.inventory_movements(household_id,inventory_item_id,delta,quantity_after,unit,reason,note,actor_user_id,operation_id) values(v_household,v_item,0,v_old.quantity,v_unit,'correction','Current balance explicitly confirmed',auth.uid(),v_op);
      update public.inventory_items set confirmed_revision=v_new_revision where id=v_item;
    end if;
  end if;
  update public.households set inventory_revision=inventory_revision+1 where id=v_household returning inventory_revision into v_revision;
  v_result:=jsonb_build_object('operationId',v_op,'replayed',false,'result',jsonb_build_object('itemId',v_item,'quantity',v_qty::text,'status',v_status,'needsReview',case when v_item is null then false else coalesce(v_old.needs_review,false) and not coalesce((p->>'confirmCurrentBalance')::boolean,false) end),'revisions',jsonb_build_object(v_item::text,v_new_revision,v_household::text,v_revision));
  perform app_private.complete_command(v_op,v_result); return v_result;
end $$;

create or replace function public.record_inventory_movement(p_command jsonb)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare p jsonb:=p_command->'payload'; v_replay jsonb; v_household uuid:=(p->>'householdId')::uuid; v_item uuid:=nullif(p->>'itemId','')::uuid; v_food uuid:=nullif(p->>'foodVersionId','')::uuid; v_delta numeric; v_set numeric:=nullif(p->>'setQuantity','')::numeric; v_balance numeric; v_new_balance numeric; v_grams numeric; v_reason text:=p->>'reason'; v_unit text:=coalesce(p->>'unit','unknown'); v_old public.inventory_items%rowtype; v_new_revision integer; v_house_rev integer; v_op uuid:=(p_command->>'operationId')::uuid; v_result jsonb; v_status text;
begin
  v_replay:=app_private.claim_command('record_inventory_movement',p_command); if v_replay is not null then return v_replay; end if;
  perform app_private.assert_role(v_household,array['owner','editor']);
  if v_reason not in ('purchase','consumption','correction','manual_add','manual_remove') then perform app_private.fail('VALIDATION'); end if;
  if v_food is not null then perform app_private.assert_food_scope(v_food,v_household); elsif nullif(btrim(p->>'freeText'),'') is null and v_item is null then perform app_private.fail('VALIDATION'); end if;
  if v_set is null then
    begin v_delta:=(p->>'delta')::numeric; exception when others then perform app_private.fail('VALIDATION'); end;
    if not public.numeric_is_finite(v_delta) or v_delta=0 then perform app_private.fail('VALIDATION'); end if;
    if v_reason in ('purchase','manual_add') and v_delta<0 or v_reason in ('consumption','manual_remove') and v_delta>0 then perform app_private.fail('VALIDATION'); end if;
  else
    if not public.numeric_is_finite(v_set) or v_set<0 or v_reason not in ('correction','manual_add') then perform app_private.fail('VALIDATION'); end if;
  end if;
  if p ? 'amountBasis' and coalesce(nullif(p->>'amountBasis',''),'unknown') not in ('edible','purchase','drained','unknown') then perform app_private.fail('VALIDATION'); end if;
  if p ? 'gramsPerUnit' and nullif(p->>'gramsPerUnit','') is not null then
    begin v_grams:=(p->>'gramsPerUnit')::numeric; exception when others then perform app_private.fail('VALIDATION'); end;
    if v_grams is null or not public.numeric_is_finite(v_grams) or v_grams<=0 then perform app_private.fail('VALIDATION'); end if;
  end if;
  if v_item is null then
    perform app_private.assert_new_revision(p_command);
    if v_set is not null then v_balance:=v_set; else v_balance:=v_delta; end if;
    if v_balance<0 then perform app_private.fail('INSUFFICIENT_STOCK'); end if;
    insert into public.inventory_items(household_id,food_version_id,compatibility_key,free_text,quantity,unit,amount_basis,qualitative_state,storage_location,status,needs_review,confirmed_at,confirmed_revision)
    values(v_household,v_food,nullif(p->>'compatibilityKey',''),nullif(btrim(p->>'freeText'),''),v_balance,v_unit,coalesce(p->>'amountBasis','unknown'),'unknown',nullif(p->>'location',''),'confirmed',false,now(),1) returning id,revision into v_item,v_new_revision;
    v_new_balance:=v_balance; v_status:='confirmed';
    v_delta:=v_balance;
  else
    select * into v_old from public.inventory_items where id=v_item and household_id=v_household for update; if not found then perform app_private.fail('NOT_FOUND'); end if;
    perform app_private.assert_revision(p_command,v_item,v_old.revision);
    if v_old.unit<>v_unit then perform app_private.fail('INCOMPATIBLE_UNIT'); end if;
    if v_set is not null then
      v_balance:=coalesce(v_old.quantity,0); v_delta:=v_set-v_balance; v_new_balance:=v_set; v_status:='confirmed';
      update public.inventory_items set quantity=v_new_balance,food_version_id=case when p ? 'foodVersionId' then v_food else food_version_id end,compatibility_key=case when p ? 'compatibilityKey' then nullif(p->>'compatibilityKey','') when p ? 'foodVersionId' then (select f.compatibility_key from public.food_versions fv join public.foods f on f.id=fv.food_id where fv.id=v_food) else compatibility_key end,free_text=case when p ? 'freeText' then nullif(btrim(p->>'freeText'),'') else free_text end,amount_basis=case when p ? 'amountBasis' then coalesce(nullif(p->>'amountBasis',''),'unknown') else amount_basis end,grams_per_unit=case when p ? 'gramsPerUnit' then nullif(p->>'gramsPerUnit','')::numeric else grams_per_unit end,storage_location=case when p ? 'location' then nullif(p->>'location','') else storage_location end,status='confirmed',needs_review=false,confirmed_at=now(),revision=revision+1 where id=v_item returning revision into v_new_revision;
    else
      if v_old.quantity is null then perform app_private.fail('QUANTITY_UNKNOWN'); end if;
      v_new_balance:=v_old.quantity+v_delta;
      if v_new_balance<0 then perform app_private.fail('INSUFFICIENT_STOCK'); end if;
      v_status:=case when v_old.needs_review then 'stale' else 'confirmed' end;
      update public.inventory_items set quantity=v_new_balance,status=v_status,revision=revision+1 where id=v_item returning revision into v_new_revision;
    end if;
    if v_set is not null then update public.inventory_items set confirmed_revision=v_new_revision where id=v_item; end if;
  end if;
  insert into public.inventory_movements(household_id,inventory_item_id,delta,quantity_after,unit,reason,note,actor_user_id,operation_id)
  values(v_household,v_item,v_delta,v_new_balance,v_unit,v_reason,nullif(p->>'note',''),auth.uid(),v_op);
  update public.households set inventory_revision=inventory_revision+1 where id=v_household returning inventory_revision into v_house_rev;
  v_result:=jsonb_build_object('operationId',v_op,'replayed',false,'result',jsonb_build_object('itemId',v_item,'balance',v_new_balance::text,'delta',v_delta::text,'status',coalesce(v_status,'confirmed')),'revisions',jsonb_build_object(v_item::text,v_new_revision,v_household::text,v_house_rev));
  perform app_private.complete_command(v_op,v_result); return v_result;
end $$;

create or replace function public.create_shopping_extra(p_command jsonb)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare p jsonb:=p_command->'payload'; v_replay jsonb; v_household uuid:=(p->>'householdId')::uuid; v_extra uuid:=nullif(p->>'extraId','')::uuid; v_food uuid:=nullif(p->>'foodVersionId','')::uuid; v_revision integer; v_new_revision integer; v_op uuid:=(p_command->>'operationId')::uuid; v_house_rev integer; v_result jsonb;
begin
  v_replay:=app_private.claim_command('create_shopping_extra',p_command); if v_replay is not null then return v_replay; end if;
  perform app_private.assert_role(v_household,array['owner','editor']); if v_food is not null then perform app_private.assert_food_scope(v_food,v_household); end if;
  if v_extra is null then
    perform app_private.assert_new_revision(p_command);
    insert into public.shopping_extras(household_id,food_version_id,label,quantity,unit,done,created_by)
    values(v_household,v_food,btrim(p->>'label'),nullif(p->>'quantity','')::numeric,nullif(p->>'unit',''),coalesce((p->>'done')::boolean,false),auth.uid()) returning id,revision into v_extra,v_new_revision;
  else
    select revision into v_revision from public.shopping_extras where id=v_extra and household_id=v_household for update; if not found then perform app_private.fail('NOT_FOUND'); end if;
    perform app_private.assert_revision(p_command,v_extra,v_revision);
    update public.shopping_extras set food_version_id=case when p ? 'foodVersionId' then v_food else food_version_id end,label=btrim(p->>'label'),quantity=case when p ? 'quantity' then nullif(p->>'quantity','')::numeric else quantity end,unit=case when p ? 'unit' then nullif(p->>'unit','') else unit end,done=coalesce((p->>'done')::boolean,done),revision=revision+1 where id=v_extra returning revision into v_new_revision;
  end if;
  update public.households set shopping_revision=shopping_revision+1 where id=v_household returning shopping_revision into v_house_rev;
  v_result:=jsonb_build_object('operationId',v_op,'replayed',false,'result',jsonb_build_object('extraId',v_extra),'revisions',jsonb_build_object(v_extra::text,v_new_revision,v_household::text,v_house_rev));
  perform app_private.complete_command(v_op,v_result); return v_result;
end $$;

create or replace function public.create_shopping_snapshot(p_command jsonb)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  p jsonb:=p_command->'payload'; v_replay jsonb; v_household uuid:=(p->>'householdId')::uuid;
  v_horizon integer; v_plan_rev integer; v_inventory_rev integer; v_snapshot uuid;
  v_item jsonb; v_food uuid; v_quantity numeric; v_basis text; v_op uuid:=(p_command->>'operationId')::uuid; v_result jsonb;
begin
  v_replay:=app_private.claim_command('create_shopping_snapshot',p_command); if v_replay is not null then return v_replay; end if;
  perform app_private.assert_role(v_household,array['owner','editor']);
  select plan_revision,inventory_revision into v_plan_rev,v_inventory_rev from public.households where id=v_household for update;
  if not found then perform app_private.fail('NOT_FOUND'); end if;
  if v_plan_rev<>(p->>'sourcePlanRevision')::integer or v_inventory_rev<>(p->>'sourceInventoryRevision')::integer then perform app_private.fail('REVISION_CONFLICT'); end if;
  v_horizon:=(p->>'horizonDays')::integer;
  if v_horizon not in (7,14) or jsonb_typeof(coalesce(p->'items','[]'::jsonb))<>'array' then perform app_private.fail('VALIDATION'); end if;
  insert into public.shopping_snapshots(household_id,horizon_days,source_plan_revision,source_inventory_revision,created_by)
  values(v_household,v_horizon,v_plan_rev,v_inventory_rev,auth.uid()) returning id into v_snapshot;
  for v_item in select value from jsonb_array_elements(coalesce(p->'items','[]'::jsonb)) loop
    v_food:=nullif(v_item->>'foodVersionId','')::uuid;
    if v_food is not null then perform app_private.assert_food_scope(v_food,v_household); end if;
    v_quantity:=nullif(v_item->>'quantity','')::numeric;
    v_basis:=coalesce(nullif(v_item->>'amountBasis',''),'unknown');
    if v_quantity is not null and (not public.numeric_is_finite(v_quantity) or v_quantity<=0)
      or v_basis not in ('edible','purchase','drained','unknown')
      or jsonb_typeof(coalesce(v_item->'causeEntryIds','[]'::jsonb))<>'array'
      or jsonb_typeof(coalesce(v_item->'causeBatchIds','[]'::jsonb))<>'array'
      or jsonb_typeof(coalesce(v_item->'inventoryItemIds','[]'::jsonb))<>'array'
    then perform app_private.fail('VALIDATION'); end if;
    if exists(select 1 from jsonb_array_elements_text(coalesce(v_item->'causeEntryIds','[]'::jsonb)) e(value)
      where not exists(select 1 from public.meal_entries x where x.id=e.value::uuid and x.household_id=v_household))
      or exists(select 1 from jsonb_array_elements_text(coalesce(v_item->'causeBatchIds','[]'::jsonb)) e(value)
      where not exists(select 1 from public.planned_batches x where x.id=e.value::uuid and x.household_id=v_household))
      or exists(select 1 from jsonb_array_elements_text(coalesce(v_item->'inventoryItemIds','[]'::jsonb)) e(value)
      where not exists(select 1 from public.inventory_items x where x.id=e.value::uuid and x.household_id=v_household))
    then perform app_private.fail('FOREIGN_ID'); end if;
    insert into public.shopping_snapshot_items(household_id,snapshot_id,line_key,food_version_id,label,quantity,unit,amount_basis,cause_entry_ids,cause_batch_ids,inventory_item_ids)
    values(v_household,v_snapshot,v_item->>'lineKey',v_food,coalesce(v_item->>'label',''),v_quantity,coalesce(v_item->>'unit','unknown'),v_basis,
      coalesce(array(select distinct x::uuid from jsonb_array_elements_text(coalesce(v_item->'causeEntryIds','[]'::jsonb)) x),'{}'),
      coalesce(array(select distinct x::uuid from jsonb_array_elements_text(coalesce(v_item->'causeBatchIds','[]'::jsonb)) x),'{}'),
      coalesce(array(select distinct x::uuid from jsonb_array_elements_text(coalesce(v_item->'inventoryItemIds','[]'::jsonb)) x),'{}'));
  end loop;
  update public.households set shopping_revision=shopping_revision+1 where id=v_household;
  v_result:=jsonb_build_object('operationId',v_op,'replayed',false,'result',jsonb_build_object('snapshotId',v_snapshot,'state','open'),'revisions',jsonb_build_object(v_snapshot::text,1));
  perform app_private.complete_command(v_op,v_result); return v_result;
end $$;

create or replace function public.mark_snapshot_ordered(p_command jsonb)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare p jsonb:=p_command->'payload'; v_replay jsonb; v_household uuid:=(p->>'householdId')::uuid; v_snapshot uuid:=(p->>'snapshotId')::uuid; v_snapshot_row public.shopping_snapshots%rowtype; v_item record; v_position uuid; v_new_revision integer; v_op uuid:=(p_command->>'operationId')::uuid; v_house_rev integer; v_result jsonb;
begin
  v_replay:=app_private.claim_command('mark_snapshot_ordered',p_command); if v_replay is not null then return v_replay; end if;
  perform app_private.assert_role(v_household,array['owner','editor']);
  select * into v_snapshot_row from public.shopping_snapshots where id=v_snapshot and household_id=v_household for update; if not found then perform app_private.fail('NOT_FOUND'); end if;
  perform app_private.assert_revision(p_command,v_snapshot,v_snapshot_row.revision);
  if v_snapshot_row.state<>'open' then perform app_private.fail('SNAPSHOT_CLOSED'); end if;
  for v_item in select * from public.shopping_snapshot_items where snapshot_id=v_snapshot and quantity is not null order by id loop
    insert into public.procurement_positions(household_id,snapshot_id,snapshot_item_id,food_version_id,label,ordered_quantity,unit,amount_basis,expected_date)
    values(v_household,v_snapshot,v_item.id,v_item.food_version_id,v_item.label,v_item.quantity,v_item.unit,v_item.amount_basis,nullif(p->>'expectedDate','')::date) returning id into v_position;
  end loop;
  update public.shopping_snapshots set state='ordered',ordered_at=coalesce(nullif(p->>'orderedAt','')::timestamptz,now()),order_reference=nullif(p->>'orderReference',''),revision=revision+1 where id=v_snapshot returning revision into v_new_revision;
  update public.households set shopping_revision=shopping_revision+1 where id=v_household returning shopping_revision into v_house_rev;
  v_result:=jsonb_build_object('operationId',v_op,'replayed',false,'result',jsonb_build_object('snapshotId',v_snapshot,'state','ordered'),'revisions',jsonb_build_object(v_snapshot::text,v_new_revision,v_household::text,v_house_rev));
  perform app_private.complete_command(v_op,v_result); return v_result;
end $$;

create or replace function public.confirm_received_items(p_command jsonb)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare p jsonb:=p_command->'payload'; v_replay jsonb; v_household uuid:=(p->>'householdId')::uuid; v_receipt jsonb; v_position uuid; v_pos public.procurement_positions%rowtype; v_quantity numeric; v_inventory public.inventory_items%rowtype; v_inventory_id uuid; v_inventory_new integer; v_position_new integer; v_house_rev integer; v_unit text; v_food uuid; v_ref text; v_movement uuid; v_op uuid:=(p_command->>'operationId')::uuid; v_results jsonb:='[]'::jsonb; v_result jsonb; v_before numeric;
begin
  v_replay:=app_private.claim_command('confirm_received_items',p_command); if v_replay is not null then return v_replay; end if;
  perform app_private.assert_role(v_household,array['owner','editor']);
  if jsonb_typeof(p->'receipts')<>'array' or jsonb_array_length(p->'receipts')=0 then perform app_private.fail('VALIDATION'); end if;
  if (select count(distinct value->>'positionId') from jsonb_array_elements(p->'receipts'))<>jsonb_array_length(p->'receipts') then perform app_private.fail('VALIDATION'); end if;
  for v_receipt in select value from jsonb_array_elements(p->'receipts') order by value->>'positionId' loop
    v_position:=(v_receipt->>'positionId')::uuid;
    select * into v_pos from public.procurement_positions where id=v_position and household_id=v_household for update;
    if not found then perform app_private.fail('FOREIGN_ID'); end if;
    perform app_private.assert_revision(p_command,v_position,v_pos.revision);
    v_quantity:=(v_receipt->>'quantity')::numeric; v_unit:=v_receipt->>'unit'; v_ref:=nullif(v_receipt->>'receiptReference',''); v_food:=coalesce(nullif(v_receipt->>'foodVersionId','')::uuid,v_pos.food_version_id);
    if not public.numeric_is_finite(v_quantity) or v_quantity<=0 or v_unit<>v_pos.unit then perform app_private.fail('VALIDATION'); end if;
    if v_quantity>v_pos.ordered_quantity-v_pos.received_quantity-v_pos.cancelled_quantity then perform app_private.fail('DUPLICATE_RECEIPT'); end if;
    if exists(select 1 from public.procurement_receipts where position_id=v_position and receipt_reference=v_ref and v_ref is not null) then perform app_private.fail('DUPLICATE_RECEIPT'); end if;
    if v_food is not null then perform app_private.assert_food_scope(v_food,v_household); end if;
    select * into v_inventory from public.inventory_items i where i.household_id=v_household and i.unit=v_unit and i.amount_basis=v_pos.amount_basis and i.quantity is not null and i.status='confirmed' and not i.needs_review and ((v_food is not null and i.food_version_id=v_food) or (v_food is null and i.food_version_id is null and i.free_text=v_pos.label)) order by i.id limit 1 for update;
    if not found then
      insert into public.inventory_items(household_id,food_version_id,free_text,quantity,unit,amount_basis,status,qualitative_state,confirmed_at,confirmed_revision)
      values(v_household,v_food,case when v_food is null then v_pos.label else null end,v_quantity,v_unit,v_pos.amount_basis,'confirmed','unknown',now(),1) returning id,revision into v_inventory_id,v_inventory_new;
      v_before:=0;
    else
      v_inventory_id:=v_inventory.id;
      if v_inventory.quantity is null then v_before:=0; else v_before:=v_inventory.quantity; end if;
      update public.inventory_items set quantity=coalesce(quantity,0)+v_quantity,status=case when needs_review then 'stale' else 'confirmed' end,confirmed_at=case when needs_review then confirmed_at else now() end,revision=revision+1 where id=v_inventory_id returning revision into v_inventory_new;
      if not v_inventory.needs_review then update public.inventory_items set confirmed_revision=v_inventory_new where id=v_inventory_id; end if;
    end if;
    insert into public.inventory_movements(household_id,inventory_item_id,delta,quantity_after,unit,reason,note,actor_user_id,operation_id) values(v_household,v_inventory_id,v_quantity,v_before+v_quantity,v_unit,'receipt','Procurement receipt',auth.uid(),v_op) returning id into v_movement;
    insert into public.procurement_receipts(household_id,position_id,inventory_movement_id,receipt_reference,quantity,unit,received_by,operation_id)
    values(v_household,v_position,v_movement,v_ref,v_quantity,v_unit,auth.uid(),v_op);
    update public.procurement_positions set received_quantity=received_quantity+v_quantity,status=case when received_quantity+v_quantity+cancelled_quantity>=ordered_quantity then 'received' else 'partial' end,revision=revision+1 where id=v_position returning revision into v_position_new;
    update public.households set inventory_revision=inventory_revision+1 where id=v_household returning inventory_revision into v_house_rev;
    v_results:=v_results||jsonb_build_array(jsonb_build_object('positionId',v_position,'receiptId',(select id from public.procurement_receipts where operation_id=v_op and position_id=v_position),'inventoryItemId',v_inventory_id,'quantity',v_quantity::text,'positionRevision',v_position_new,'inventoryRevision',v_house_rev));
  end loop;
  update public.households set shopping_revision=shopping_revision+1 where id=v_household;
  v_result:=jsonb_build_object('operationId',v_op,'replayed',false,'result',jsonb_build_object('receipts',v_results),'revisions',jsonb_build_object(v_household::text,v_house_rev));
  perform app_private.complete_command(v_op,v_result); return v_result;
end $$;

create or replace function public.cancel_procurement(p_command jsonb)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare p jsonb:=p_command->'payload'; v_replay jsonb; v_household uuid:=(p->>'householdId')::uuid; v_position uuid:=(p->>'positionId')::uuid; v_pos public.procurement_positions%rowtype; v_quantity numeric; v_new_revision integer; v_house_rev integer; v_op uuid:=(p_command->>'operationId')::uuid; v_result jsonb;
begin
  v_replay:=app_private.claim_command('cancel_procurement',p_command); if v_replay is not null then return v_replay; end if;
  perform app_private.assert_role(v_household,array['owner','editor']);
  select * into v_pos from public.procurement_positions where id=v_position and household_id=v_household for update; if not found then perform app_private.fail('NOT_FOUND'); end if;
  perform app_private.assert_revision(p_command,v_position,v_pos.revision);
  v_quantity:=(p->>'quantity')::numeric;
  if not public.numeric_is_finite(v_quantity) or v_quantity<=0 or v_quantity>v_pos.ordered_quantity-v_pos.received_quantity-v_pos.cancelled_quantity then perform app_private.fail('VALIDATION'); end if;
  update public.procurement_positions set cancelled_quantity=cancelled_quantity+v_quantity,status=case when received_quantity+cancelled_quantity+v_quantity>=ordered_quantity then 'cancelled' else status end,revision=revision+1 where id=v_position returning revision into v_new_revision;
  update public.shopping_snapshots set revision=revision+1 where id=v_pos.snapshot_id;
  update public.households set shopping_revision=shopping_revision+1 where id=v_household returning shopping_revision into v_house_rev;
  v_result:=jsonb_build_object('operationId',v_op,'replayed',false,'result',jsonb_build_object('positionId',v_position,'cancelledQuantity',v_quantity::text),'revisions',jsonb_build_object(v_position::text,v_new_revision,v_household::text,v_house_rev));
  perform app_private.complete_command(v_op,v_result); return v_result;
end $$;

create or replace function public.save_merchant_preference(p_command jsonb)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare p jsonb:=p_command->'payload'; v_replay jsonb; v_household uuid:=(p->>'householdId')::uuid; v_revision integer; v_new_revision integer; v_link jsonb; v_op uuid:=(p_command->>'operationId')::uuid; v_result jsonb;
begin
  v_replay:=app_private.claim_command('save_merchant_preference',p_command); if v_replay is not null then return v_replay; end if;
  perform app_private.assert_role(v_household,array['owner','editor']);
  select revision into v_revision from public.merchant_preferences where household_id=v_household for update;
  if found then perform app_private.assert_revision(p_command,v_household,v_revision); else perform app_private.assert_new_revision(p_command); end if;
  if jsonb_typeof(coalesce(p->'links','[]'::jsonb))<>'array' then perform app_private.fail('VALIDATION'); end if;
  insert into public.merchant_preferences(household_id,postal_code,city,favorite_merchant,updated_by)
  values(v_household,nullif(p->>'postalCode',''),nullif(p->>'city',''),nullif(p->>'favoriteMerchant',''),auth.uid())
  on conflict(household_id) do update set postal_code=excluded.postal_code,city=excluded.city,favorite_merchant=excluded.favorite_merchant,updated_by=excluded.updated_by,revision=public.merchant_preferences.revision+1,updated_at=now()
  returning revision into v_new_revision;
  delete from public.merchant_links where household_id=v_household;
  for v_link in select value from jsonb_array_elements(coalesce(p->'links','[]'::jsonb)) loop
    if (v_link->>'url') !~ '^https://' or v_link->>'linkType' not in ('product','search','store','map') then perform app_private.fail('VALIDATION'); end if;
    insert into public.merchant_links(household_id,label,url,link_type,created_by) values(v_household,btrim(v_link->>'label'),v_link->>'url',v_link->>'linkType',auth.uid());
  end loop;
  v_result:=jsonb_build_object('operationId',v_op,'replayed',false,'result',jsonb_build_object('householdId',v_household),'revisions',jsonb_build_object(v_household::text,v_new_revision));
  perform app_private.complete_command(v_op,v_result); return v_result;
end $$;

grant execute on function public.save_inventory_status(jsonb),public.record_inventory_movement(jsonb),public.create_shopping_extra(jsonb),public.create_shopping_snapshot(jsonb),public.mark_snapshot_ordered(jsonb),public.confirm_received_items(jsonb),public.cancel_procurement(jsonb),public.save_merchant_preference(jsonb) to authenticated;
