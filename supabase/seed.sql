-- Opt-in local fixture only. Invented test values; not real foods, measurements, or nutrition advice.
-- This file is intentionally not configured as an automatic Supabase seed.
begin;

insert into public.food_sources(id,code,name,license,attribution,source_url)
values(
  '00000000-0000-4000-8000-000000000099',
  'synthetic_test',
  'Supper Board synthetische Testdaten',
  'Synthetic software-test fixture; values are invented and are not nutrition guidance.',
  'Supper Board synthetic test fixture',
  null
)
on conflict(id) do nothing;

insert into public.source_releases(
  id,source_id,release_code,source_sha256,source_url,status,import_report
) values(
  '00000000-0000-4000-8000-000000000098',
  '00000000-0000-4000-8000-000000000099',
  'synthetic_test_v1',
  encode(extensions.digest(convert_to('supper-board-synthetic-fixture-v1|TEST_A=100kcal,10g-protein|TEST_B=200kcal,20g-protein','UTF8'),'sha256'),'hex'),
  null,
  'active',
  '{"fixture":true,"fixtureVersion":"1","synthetic":true}'::jsonb
)
on conflict(id) do nothing;

insert into public.categories(id,code,name_de,name_en,hierarchy_version)
values(
  '00000000-0000-4000-8000-000000000097',
  'synthetic_test',
  'Synthetische Testdaten',
  'Synthetic test data',
  'synthetic_test_v1'
)
on conflict(id) do nothing;

insert into public.source_components(source_id,component_code,name_de,name_en,unit,group_code,usage_description,metadata)
values
  ('00000000-0000-4000-8000-000000000099','TEST_ENERCC','Testenergie','Test energy','kcal','energy','Invented software fixture value; not a real food measurement.','{"synthetic":true}'::jsonb),
  ('00000000-0000-4000-8000-000000000099','TEST_PROT','Testprotein','Test protein','g','protein','Invented software fixture value; not a real food measurement.','{"synthetic":true}'::jsonb)
on conflict(source_id,component_code) do nothing;

insert into public.nutrient_mappings(source_id,source_component_code,nutrient_definition_id,mapping_version,mapping_status,source_unit,transform,reviewed_by,reviewed_at)
select '00000000-0000-4000-8000-000000000099',m.component_code,n.id,'synthetic_test_v1','reviewed',m.unit,'{}'::jsonb,'synthetic-test-fixture','2026-10-06T00:00:00Z'
from (values ('TEST_ENERCC','energy_kcal','kcal'),('TEST_PROT','protein','g')) as m(component_code,nutrient_code,unit)
join public.nutrient_definitions n on n.code=m.nutrient_code
on conflict(source_id,source_component_code,mapping_version) do nothing;

insert into public.foods(id,source_id,source_food_code,compatibility_key)
values
  ('00000000-0000-4000-8000-000000000091','00000000-0000-4000-8000-000000000099','TEST_A','synthetic_test_a'),
  ('00000000-0000-4000-8000-000000000092','00000000-0000-4000-8000-000000000099','TEST_B','synthetic_test_b')
on conflict(id) do nothing;

insert into public.food_versions(id,food_id,source_release_id,version_number,name_de,name_en,preparation_state,source_notes,nutrient_basis)
values
  ('00000000-0000-4000-8000-000000000081','00000000-0000-4000-8000-000000000091','00000000-0000-4000-8000-000000000098',1,'TEST-Food A — synthetisch','TEST Food A — synthetic','fixture','Invented test data: 100 kcal and 10 g protein per 100 g; no claim about an actual food.','edible'),
  ('00000000-0000-4000-8000-000000000082','00000000-0000-4000-8000-000000000092','00000000-0000-4000-8000-000000000098',1,'TEST-Food B — synthetisch','TEST Food B — synthetic','fixture','Invented test data: 200 kcal and 20 g protein per 100 g; no claim about an actual food.','edible')
on conflict(id) do nothing;

insert into public.food_nutrient_values(food_version_id,source_component_code,nutrient_definition_id,raw_value,normalized_amount,unit,value_status,source_method,source_reference,mapping_version)
select fixture.food_version_id,fixture.component_code,n.id,fixture.amount::text,fixture.amount,fixture.unit,'numeric','synthetic-fixture','Roadmap §15.1 software test data only','synthetic_test_v1'
from (values
  ('00000000-0000-4000-8000-000000000081'::uuid,'TEST_ENERCC','energy_kcal',100::numeric,'kcal'),
  ('00000000-0000-4000-8000-000000000081'::uuid,'TEST_PROT','protein',10::numeric,'g'),
  ('00000000-0000-4000-8000-000000000082'::uuid,'TEST_ENERCC','energy_kcal',200::numeric,'kcal'),
  ('00000000-0000-4000-8000-000000000082'::uuid,'TEST_PROT','protein',20::numeric,'g')
) as fixture(food_version_id,component_code,nutrient_code,amount,unit)
join public.nutrient_definitions n on n.code=fixture.nutrient_code
on conflict(food_version_id,source_component_code) do nothing;

insert into public.food_categories(food_version_id,category_id,is_primary,source_category_code)
values
  ('00000000-0000-4000-8000-000000000081','00000000-0000-4000-8000-000000000097',true,'synthetic_test'),
  ('00000000-0000-4000-8000-000000000082','00000000-0000-4000-8000-000000000097',true,'synthetic_test')
on conflict(food_version_id,category_id) do nothing;

commit;
