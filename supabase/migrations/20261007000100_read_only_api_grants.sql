-- Hosted Supabase grants browser roles write access by default. App access is
-- explicit: reads go through RLS; all mutations go through authenticated RPCs.
-- PostgreSQL 17 is pinned by supabase/config.toml.
alter default privileges for role postgres in schema public
  revoke all on tables from anon, authenticated;

revoke insert, update, delete, truncate, references, trigger, maintain
  on all tables in schema public from anon, authenticated;

-- Never inherit anonymous read grants for household, profile or command data.
revoke select on all tables in schema public from anon;
grant select on
  public.food_sources,
  public.source_releases,
  public.nutrient_definitions,
  public.source_components,
  public.nutrient_mappings,
  public.categories,
  public.foods,
  public.food_versions,
  public.food_nutrient_values,
  public.food_categories,
  public.food_tags,
  public.food_measures,
  public.food_synonyms,
  public.reference_packs,
  public.reference_values
  to anon;

-- Keep the existing per-table authenticated SELECT grants and RLS policies.
-- Platform-owned supabase_admin defaults are not app-migration privileges.
