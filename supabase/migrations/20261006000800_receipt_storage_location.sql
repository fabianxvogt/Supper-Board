begin;

alter table public.procurement_receipts
  add column storage_location text
  check (storage_location is null or storage_location in ('pantry','fridge','freezer'));

create or replace function public.confirm_received_items(p_command jsonb)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  p jsonb:=p_command->'payload'; v_replay jsonb; v_household uuid:=(p->>'householdId')::uuid; v_receipt jsonb; v_position uuid;
  v_pos public.procurement_positions%rowtype; v_quantity numeric; v_inventory public.inventory_items%rowtype; v_inventory_id uuid;
  v_inventory_new integer; v_position_new integer; v_house_rev integer; v_unit text; v_food uuid; v_ref text;
  v_location text; v_movement uuid; v_op uuid:=(p_command->>'operationId')::uuid; v_results jsonb:='[]'::jsonb;
  v_result jsonb; v_before numeric;
begin
  v_replay:=app_private.claim_command('confirm_received_items',p_command);
  if v_replay is not null then return v_replay; end if;
  perform app_private.assert_role(v_household,array['owner','editor']);
  if jsonb_typeof(p->'receipts')<>'array' or jsonb_array_length(p->'receipts')=0 then perform app_private.fail('VALIDATION'); end if;
  if (select count(distinct value->>'positionId') from jsonb_array_elements(p->'receipts'))<>jsonb_array_length(p->'receipts') then perform app_private.fail('VALIDATION'); end if;
  for v_receipt in select value from jsonb_array_elements(p->'receipts') order by value->>'positionId' loop
    v_position:=(v_receipt->>'positionId')::uuid;
    select * into v_pos from public.procurement_positions where id=v_position and household_id=v_household for update;
    if not found then perform app_private.fail('FOREIGN_ID'); end if;
    perform app_private.assert_revision(p_command,v_position,v_pos.revision);
    v_quantity:=(v_receipt->>'quantity')::numeric;
    v_unit:=v_receipt->>'unit';
    v_ref:=nullif(v_receipt->>'receiptReference','');
    v_food:=coalesce(nullif(v_receipt->>'foodVersionId','')::uuid,v_pos.food_version_id);
    v_location:=nullif(btrim(v_receipt->>'storageLocation'),'');
    if not public.numeric_is_finite(v_quantity) or v_quantity<=0 or v_unit<>v_pos.unit
      or v_location not in ('pantry','fridge','freezer') then perform app_private.fail('VALIDATION'); end if;
    if v_quantity>v_pos.ordered_quantity-v_pos.received_quantity-v_pos.cancelled_quantity then perform app_private.fail('DUPLICATE_RECEIPT'); end if;
    if exists(select 1 from public.procurement_receipts where position_id=v_position and receipt_reference=v_ref and v_ref is not null) then perform app_private.fail('DUPLICATE_RECEIPT'); end if;
    if v_food is not null then perform app_private.assert_food_scope(v_food,v_household); end if;
    select * into v_inventory from public.inventory_items i
    where i.household_id=v_household and i.unit=v_unit and i.amount_basis=v_pos.amount_basis
      and i.storage_location=v_location and i.quantity is not null and i.status='confirmed' and not i.needs_review
      and ((v_food is not null and i.food_version_id=v_food) or (v_food is null and i.food_version_id is null and i.free_text=v_pos.label))
    order by i.id limit 1 for update;
    if not found then
      insert into public.inventory_items(
        household_id,food_version_id,free_text,quantity,unit,amount_basis,storage_location,status,
        qualitative_state,confirmed_at,confirmed_revision
      ) values (
        v_household,v_food,case when v_food is null then v_pos.label else null end,v_quantity,v_unit,v_pos.amount_basis,v_location,
        'confirmed','unknown',now(),1
      ) returning id,revision into v_inventory_id,v_inventory_new;
      v_before:=0;
    else
      v_inventory_id:=v_inventory.id;
      v_before:=v_inventory.quantity;
      update public.inventory_items
      set quantity=quantity+v_quantity,status='confirmed',confirmed_at=now(),revision=revision+1
      where id=v_inventory_id returning revision into v_inventory_new;
      update public.inventory_items set confirmed_revision=v_inventory_new where id=v_inventory_id;
    end if;
    insert into public.inventory_movements(household_id,inventory_item_id,delta,quantity_after,unit,reason,note,actor_user_id,operation_id)
    values(v_household,v_inventory_id,v_quantity,v_before+v_quantity,v_unit,'receipt','Procurement receipt',auth.uid(),v_op)
    returning id into v_movement;
    insert into public.procurement_receipts(household_id,position_id,inventory_movement_id,receipt_reference,quantity,unit,storage_location,received_by,operation_id)
    values(v_household,v_position,v_movement,v_ref,v_quantity,v_unit,v_location,auth.uid(),v_op);
    update public.procurement_positions
    set received_quantity=received_quantity+v_quantity,
      status=case when received_quantity+v_quantity+cancelled_quantity>=ordered_quantity then 'received' else 'partial' end,
      revision=revision+1
    where id=v_position returning revision into v_position_new;
    update public.households set inventory_revision=inventory_revision+1 where id=v_household returning inventory_revision into v_house_rev;
    v_results:=v_results||jsonb_build_array(jsonb_build_object(
      'positionId',v_position,'receiptId',(select id from public.procurement_receipts where operation_id=v_op and position_id=v_position),
      'inventoryItemId',v_inventory_id,'quantity',v_quantity::text,'storageLocation',v_location,
      'positionRevision',v_position_new,'inventoryRevision',v_house_rev
    ));
  end loop;
  update public.households set shopping_revision=shopping_revision+1 where id=v_household;
  v_result:=jsonb_build_object('operationId',v_op,'replayed',false,'result',jsonb_build_object('receipts',v_results),'revisions',jsonb_build_object(v_household::text,v_house_rev));
  perform app_private.complete_command(v_op,v_result);
  return v_result;
end $$;

commit;
