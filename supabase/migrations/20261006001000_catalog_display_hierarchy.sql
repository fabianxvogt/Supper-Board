insert into public.categories (code,name_de,name_en,parent_id,hierarchy_version) values
  ('display_vegetables_mushrooms','Gemüse & Pilze',null,null,'supper-board-display-v1'),
  ('display_fruit','Obst',null,null,'supper-board-display-v1'),
  ('display_grains_potatoes_starches','Getreide, Kartoffeln & Stärkeprodukte',null,null,'supper-board-display-v1'),
  ('display_legumes_nuts_seeds','Hülsenfrüchte, Nüsse & Samen',null,null,'supper-board-display-v1'),
  ('display_dairy_eggs_alternatives','Milchprodukte, Eier & Alternativen',null,null,'supper-board-display-v1'),
  ('display_meat_fish_alternatives','Fleisch, Fisch & Alternativen',null,null,'supper-board-display-v1'),
  ('display_fats_oils','Fette & Öle',null,null,'supper-board-display-v1'),
  ('display_drinks','Getränke',null,null,'supper-board-display-v1'),
  ('display_seasonings_cooking','Würzmittel & Kochzutaten',null,null,'supper-board-display-v1'),
  ('display_sweets_snacks','Süßwaren & Knabbereien',null,null,'supper-board-display-v1'),
  ('display_composed_dishes','Zusammengesetzte Speisen',null,null,'supper-board-display-v1')
on conflict (code) do update set
  name_de=excluded.name_de,
  name_en=excluded.name_en,
  parent_id=null,
  hierarchy_version=excluded.hierarchy_version;

update public.categories as source_group
set parent_id=display_root.id
from (values
  ('bls_bread','display_grains_potatoes_starches'),
  ('bls_cereals','display_grains_potatoes_starches'),
  ('bls_fine_baked_goods','display_sweets_snacks'),
  ('bls_eggs_pasta','display_dairy_eggs_alternatives'),
  ('bls_fruit','display_fruit'),
  ('bls_vegetables','display_vegetables_mushrooms'),
  ('bls_legumes_nuts_alternatives','display_legumes_nuts_seeds'),
  ('bls_potatoes_starches_mushrooms','display_grains_potatoes_starches'),
  ('bls_dairy','display_dairy_eggs_alternatives'),
  ('bls_non_alcoholic_drinks','display_drinks'),
  ('bls_alcoholic_drinks','display_drinks'),
  ('bls_fats_oils','display_fats_oils'),
  ('bls_seasonings_cooking','display_seasonings_cooking'),
  ('bls_sweets','display_sweets_snacks'),
  ('bls_fish_shellfish','display_meat_fish_alternatives'),
  ('bls_red_meat','display_meat_fish_alternatives'),
  ('bls_game_poultry_offal','display_meat_fish_alternatives'),
  ('bls_meat_products','display_meat_fish_alternatives'),
  ('bls_plant_dominant_dishes','display_composed_dishes'),
  ('bls_animal_dominant_dishes','display_composed_dishes')
) as crosswalk(source_code,parent_code)
join public.categories as display_root on display_root.code=crosswalk.parent_code
where source_group.code=crosswalk.source_code
  and source_group.hierarchy_version='bls4-source-groups-v1';

create or replace function public.search_food_catalog(
  p_query text,
  p_household_id uuid,
  p_category_id uuid,
  p_tags text[],
  p_source_mode text,
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
  v_category_ids uuid[];
begin
  if length(v_query)>200 or coalesce(p_offset,-1)<0 or p_offset>100000 or coalesce(p_limit,0)<1 or p_limit>100
    or cardinality(v_tags)>20 or exists(select 1 from unnest(v_tags) t where length(btrim(t)) not between 1 and 80)
    or coalesce(p_source_mode,'') not in ('all','bls','household')
  then raise exception using message='VALIDATION',errcode='P0001'; end if;
  v_escaped:=replace(v_query,E'\\',E'\\\\');
  v_escaped:=replace(v_escaped,'%',E'\\%');
  v_escaped:=replace(v_escaped,'_',E'\\_');
  if p_category_id is not null then
    with recursive category_tree(id) as (
      select p_category_id
      union
      select child.id
      from public.categories child
      join category_tree parent on child.parent_id=parent.id
    )
    select coalesce(array_agg(id),'{}'::uuid[])
      into v_category_ids
      from category_tree;
  end if;
  select r.id into v_active
  from public.source_releases r
  join public.food_sources s on s.id=r.source_id
  where r.status='active' and s.code='bls_4_0'
  order by r.imported_at desc,r.id limit 1;
  select coalesce(jsonb_agg(q.item order by q.name_de,q.id),'[]'::jsonb) into v_rows
  from (
    select v.name_de,v.id,
      jsonb_build_object('id',v.id,'food_id',v.food_id,'name_de',v.name_de,'name_en',v.name_en,
        'preparation_state',v.preparation_state,'source_release_id',v.source_release_id,'nutrient_basis',v.nutrient_basis,
        'foods',jsonb_build_object('id',f.id,'source_id',f.source_id,'source_food_code',f.source_food_code,
          'owner_household_id',f.owner_household_id,'owner_user_id',f.owner_user_id,'compatibility_key',f.compatibility_key)) as item
    from public.food_versions v join public.foods f on f.id=v.food_id
    where (
        p_source_mode='all' and (
          f.source_id is not null and exists(select 1 from public.source_releases r where r.id=v.source_release_id and r.status='active')
          or p_household_id is not null and f.owner_household_id=p_household_id
            and public.has_household_role(p_household_id,array['owner','editor','viewer'])
          or f.owner_user_id=auth.uid()
        )
        or p_source_mode='bls' and f.source_id='00000000-0000-4000-8000-000000000001'::uuid
          and exists(select 1 from public.source_releases r where r.id=v.source_release_id and r.source_id=f.source_id and r.status='active')
        or p_source_mode='household' and p_household_id is not null
          and f.owner_household_id=p_household_id
          and public.has_household_role(p_household_id,array['owner','editor','viewer'])
      )
      and (p_category_id is null or exists(
        select 1 from public.food_categories c
        where c.food_version_id=v.id and c.category_id=any(v_category_ids)
      ))
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

revoke all on function public.search_food_catalog(text,uuid,uuid,text[],text,integer,integer) from public;
grant execute on function public.search_food_catalog(text,uuid,uuid,text[],text,integer,integer) to anon,authenticated;
