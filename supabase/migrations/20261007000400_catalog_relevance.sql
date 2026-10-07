-- General German word/stem relevance. No substring matching inside compounds:
-- e.g. Reis is a token in Reis gekocht, not in Erdbeereis. Prefixes remain useful
-- for incomplete input but rank below exact/stem-token matches. Source synonyms
-- participate without modifying source names, nutrients or preparation states.
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
  v_normalized text;
  v_tokens text[];
  v_lead text[];
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
  v_normalized:=lower(regexp_replace(v_query,'[[:space:]]+',' ','g'));
  -- German Snowball leaves -eln plurals intact. Normalize that grammatical
  -- suffix in both query and labels before stemming, never specific food names.
  v_tokens:=pg_catalog.tsvector_to_array(pg_catalog.to_tsvector('pg_catalog.german'::regconfig,regexp_replace(coalesce(v_query,''),'eln\M','el','gi')));
  v_lead:=pg_catalog.tsvector_to_array(pg_catalog.to_tsvector('pg_catalog.german'::regconfig,regexp_replace(split_part(coalesce(v_normalized,''),' ',1),'eln\M','el','gi')));
  if p_category_id is not null then
    with recursive category_tree(id) as (
      select p_category_id
      union
      select child.id from public.categories child join category_tree parent on child.parent_id=parent.id
    )
    select coalesce(array_agg(id),'{}'::uuid[]) into v_category_ids from category_tree;
  end if;
  select r.id into v_active
  from public.source_releases r join public.food_sources s on s.id=r.source_id
  where r.status='active' and s.code='bls_4_0'
  order by r.imported_at desc,r.id limit 1;

  select coalesce(jsonb_agg(q.item order by q.relevance,q.name_de,q.id),'[]'::jsonb) into v_rows
  from (
    select v.name_de,v.id,coalesce(relevance.score,0) as relevance,
      jsonb_build_object('id',v.id,'food_id',v.food_id,'name_de',v.name_de,'name_en',v.name_en,
        'preparation_state',v.preparation_state,'source_release_id',v.source_release_id,'nutrient_basis',v.nutrient_basis,
        'foods',jsonb_build_object('id',f.id,'source_id',f.source_id,'source_food_code',f.source_food_code,
          'owner_household_id',f.owner_household_id,'owner_user_id',f.owner_user_id,'compatibility_key',f.compatibility_key)) as item
    from public.food_versions v join public.foods f on f.id=v.food_id
    left join lateral (
      select min(match.kind*10000 + greatest(cardinality(label.tokens)-cardinality(v_tokens),0)*10 + label.priority) as score
      from (
        select names.label,names.priority,
          lower(regexp_replace(btrim(names.label),'[[:space:]]+',' ','g')) as normalized,
          pg_catalog.tsvector_to_array(pg_catalog.to_tsvector('pg_catalog.german'::regconfig,regexp_replace(names.label,'eln\M','el','gi'))) as tokens,
          pg_catalog.tsvector_to_array(pg_catalog.to_tsvector('pg_catalog.german'::regconfig,regexp_replace(split_part(btrim(names.label),' ',1),'eln\M','el','gi'))) as leading
        from (
          select v.name_de as label,0 as priority
          union all select v.name_en,1 where v.name_en is not null
          union all select s.synonym,2 from public.food_synonyms s where s.food_version_id=v.id
        ) names
        where v_query is not null
      ) label
      cross join lateral (
        select case
          when label.normalized=v_normalized then 0
          when cardinality(v_tokens)>0 and label.tokens=v_tokens then 1
          when cardinality(v_tokens)>0 and label.tokens @> v_tokens then
            case when cardinality(v_lead)>0 and label.leading @> v_lead then 2 else 3 end
          when cardinality(v_tokens)>0 and not exists(
            select 1 from unnest(v_tokens) query_token
            where not exists(select 1 from unnest(label.tokens) name_token where pg_catalog.starts_with(name_token,query_token))
          ) then 4
          else null
        end as kind
      ) match
      where match.kind is not null
    ) relevance on true
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
        select 1 from public.food_categories c where c.food_version_id=v.id and c.category_id=any(v_category_ids)
      ))
      and (cardinality(v_tags)=0 or not exists(
        select tag from unnest(v_tags) requested(tag)
        except select ft.tag from public.food_tags ft where ft.food_version_id=v.id
      ))
      and (v_query is null or relevance.score is not null)
    order by relevance,v.name_de,v.id
    offset p_offset limit p_limit+1
  ) q;
  select coalesce(jsonb_agg(value order by ordinality),'[]'::jsonb)
  into v_items from jsonb_array_elements(v_rows) with ordinality e(value,ordinality) where ordinality<=p_limit;
  return jsonb_build_object('items',v_items,'hasMore',jsonb_array_length(v_rows)>p_limit,'activeReleaseId',v_active);
end $$;

revoke all on function public.search_food_catalog(text,uuid,uuid,text[],text,integer,integer) from public;
grant execute on function public.search_food_catalog(text,uuid,uuid,text[],text,integer,integer) to anon,authenticated;
