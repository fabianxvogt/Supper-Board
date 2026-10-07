create or replace function public.set_recipe_favorite(p_command jsonb)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  p jsonb:=p_command->'payload'; v_replay jsonb; v_household uuid:=(p->>'householdId')::uuid; v_version uuid:=(p->>'recipeVersionId')::uuid; v_recipe_revision integer; v_favorite_revision integer; v_new_revision integer; v_favorite boolean:=(p->>'favorite')::boolean; v_op uuid:=(p_command->>'operationId')::uuid; v_result jsonb;
begin
  v_replay:=app_private.claim_command('set_recipe_favorite',p_command); if v_replay is not null then return v_replay; end if;
  perform app_private.assert_role(v_household,array['owner','editor','viewer']);
  select r.revision into v_recipe_revision from public.recipe_versions rv join public.recipes r on r.id=rv.recipe_id and r.household_id=rv.household_id where rv.id=v_version and rv.household_id=v_household for update of r;
  if not found then perform app_private.fail('FOREIGN_ID'); end if;
  select revision into v_favorite_revision from public.recipe_favorites where user_id=auth.uid() and household_id=v_household and recipe_version_id=v_version for update;
  if found then
    perform app_private.assert_revision(p_command,v_version,v_favorite_revision);
    update public.recipe_favorites set is_favorite=v_favorite,revision=revision+1,updated_at=now() where user_id=auth.uid() and household_id=v_household and recipe_version_id=v_version returning revision into v_new_revision;
  else
    perform app_private.assert_new_revision(p_command,v_version::text);
    insert into public.recipe_favorites(user_id,household_id,recipe_version_id,is_favorite) values(auth.uid(),v_household,v_version,v_favorite) returning revision into v_new_revision;
  end if;
  v_result:=jsonb_build_object('operationId',v_op,'replayed',false,'result',jsonb_build_object('recipeVersionId',v_version,'favorite',v_favorite),'revisions',jsonb_build_object(v_version::text,v_new_revision));
  perform app_private.complete_command(v_op,v_result); return v_result;
end $$;

grant execute on function public.set_recipe_favorite(jsonb) to authenticated;
