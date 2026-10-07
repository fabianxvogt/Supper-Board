-- Clean cutover: payload.lines replaces the single lineKey/lineFingerprint fields.
-- One household lock, source-revision guard and shopping revision cover the entire group.
create or replace function public.set_shopping_checkoff(p_command jsonb)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  p jsonb:=p_command->'payload'; v_replay jsonb; v_household uuid:=(p->>'householdId')::uuid;
  v_line jsonb; v_key text; v_fingerprint text; v_checked boolean; v_plan integer; v_inventory integer;
  v_shopping integer; v_line_revision integer; v_new_shopping integer;
  v_lines jsonb:='[]'::jsonb; v_revisions jsonb:='{}'::jsonb;
  v_result jsonb; v_op uuid:=(p_command->>'operationId')::uuid;
begin
  v_replay:=app_private.claim_command('set_shopping_checkoff',p_command); if v_replay is not null then return v_replay; end if;
  perform app_private.assert_role(v_household,array['owner','editor']);
  if jsonb_typeof(p->'checked') is distinct from 'boolean' or jsonb_typeof(p->'lines') is distinct from 'array'
     or p ? 'lineKey' or p ? 'lineFingerprint' then perform app_private.fail('VALIDATION'); end if;
  if jsonb_array_length(p->'lines') < 1 then perform app_private.fail('VALIDATION'); end if;
  -- Validate every line before changing any checkoff; duplicate keys cannot advance a line twice.
  for v_line in select value from jsonb_array_elements(p->'lines') loop
    v_key:=v_line->>'lineKey'; v_fingerprint:=v_line->>'lineFingerprint';
    if jsonb_typeof(v_line) is distinct from 'object' or jsonb_typeof(v_line->'lineKey') is distinct from 'string'
       or v_key is null or length(btrim(v_key)) not between 1 and 500 or v_key<>btrim(v_key)
       or jsonb_typeof(v_line->'lineFingerprint') is distinct from 'string'
       or v_fingerprint is null or v_fingerprint !~ '^[0-9a-f]{64}$' then perform app_private.fail('VALIDATION'); end if;
  end loop;
  if (select count(*) from jsonb_array_elements(p->'lines')) <>
     (select count(distinct value->>'lineKey') from jsonb_array_elements(p->'lines')) then perform app_private.fail('VALIDATION'); end if;
  v_checked:=(p->>'checked')::boolean;
  select plan_revision,inventory_revision,shopping_revision into v_plan,v_inventory,v_shopping
  from public.households where id=v_household for update;
  if not found then perform app_private.fail('NOT_FOUND'); end if;
  perform app_private.assert_revision(p_command,v_household,v_shopping);
  if (p->>'sourcePlanRevision')::integer is distinct from v_plan or (p->>'sourceInventoryRevision')::integer is distinct from v_inventory then perform app_private.fail('REVISION_CONFLICT'); end if;
  for v_line in select value from jsonb_array_elements(p->'lines') loop
    v_key:=v_line->>'lineKey'; v_fingerprint:=v_line->>'lineFingerprint';
    insert into public.shopping_checkoffs as checkoff(household_id,line_key,source_plan_revision,source_inventory_revision,line_fingerprint,checked,checked_by,checked_at,revision)
    values(v_household,v_key,v_plan,v_inventory,v_fingerprint,v_checked,case when v_checked then auth.uid() else null end,case when v_checked then now() else null end,1)
    on conflict(household_id,line_key) do update set source_plan_revision=excluded.source_plan_revision,
      source_inventory_revision=excluded.source_inventory_revision,line_fingerprint=excluded.line_fingerprint,checked=excluded.checked,
      checked_by=excluded.checked_by,checked_at=excluded.checked_at,revision=checkoff.revision+1,updated_at=now()
    returning revision into v_line_revision;
    v_lines:=v_lines||jsonb_build_array(jsonb_build_object('lineKey',v_key,'lineFingerprint',v_fingerprint,'revision',v_line_revision));
    v_revisions:=v_revisions||jsonb_build_object(v_key,v_line_revision);
  end loop;
  update public.households set shopping_revision=shopping_revision+1 where id=v_household returning shopping_revision into v_new_shopping;
  v_result:=jsonb_build_object('operationId',v_op,'replayed',false,'result',jsonb_build_object('lines',v_lines,'checked',v_checked,'sourcePlanRevision',v_plan,'sourceInventoryRevision',v_inventory),'revisions',v_revisions||jsonb_build_object(v_household::text,v_new_shopping));
  perform app_private.complete_command(v_op,v_result); return v_result;
end $$;

revoke all on function public.set_shopping_checkoff(jsonb) from public,anon;
grant execute on function public.set_shopping_checkoff(jsonb) to authenticated;
