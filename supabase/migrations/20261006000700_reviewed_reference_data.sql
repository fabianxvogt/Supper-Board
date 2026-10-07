begin;

insert into public.reference_packs(
  code,version,source_title,source_url,license,review_status,reviewed_at,review_note
) values (
  'efsa_standard_adult',
  'efsa_standard_adult_reviewed_v1_2026-10-06',
  'EFSA dietary reference values for selected nutrients in the standard-adult context',
  'https://www.efsa.europa.eu/en/topics/topic/dietary-reference-values',
  'See docs/DATA_SOURCES.md and docs/REFERENCE_REVIEW.md. No blanket rights to redistribute source articles are asserted; individual notices control.',
  'approved',
  '2026-10-06T00:00:00Z',
  'Independent source-by-source review: docs/REFERENCE_REVIEW.md. Q37 remains conditional and is intentionally absent. Only attributed numerical reference facts/source metadata are stored; source article text and tables are not redistributed. Safe-and-adequate sodium is retained as a distinct category and cannot be adopted as a personal target.'
)
on conflict(code,version) do update set
  source_title=excluded.source_title,source_url=excluded.source_url,license=excluded.license,
  review_status=excluded.review_status,reviewed_at=excluded.reviewed_at,review_note=excluded.review_note;

with pack as (
  select id from public.reference_packs
  where code='efsa_standard_adult' and version='efsa_standard_adult_reviewed_v1_2026-10-06'
), values_to_seed(
  immutable_key,nutrient_code,cohort,age_min_years,age_max_years,value,unit,reference_kind,target_unit,
  minimum,maximum,reference_type,conditions,source_document,source_locator
) as (values
  ('efsa_q27_protein_pri','protein','adult_both_sexes',18::numeric,null::numeric,0.83::numeric,'g/kg/day','per_kg','g',null::numeric,null::numeric,'PRI','Adult PRI for both sexes and all adult ages. Daily grams require an explicitly confirmed body-weight basis.','EFSA Journal 2012;10(2):2557; https://doi.org/10.2903/j.efsa.2012.2557','Q27; §6.1, p. 30'),
  ('efsa_q28_available_carbohydrate_ri','available_carbohydrate','adult_both_sexes',18,null,45,'energy_percent','energy_percent',null,45,60,'RI','Adult RI of total energy. Gram conversion is an explicit planning convention, not a polyol-adjusted energy share.','EFSA Journal 2010;8(3):1462; https://doi.org/10.2903/j.efsa.2010.1462','Q28; §6.1, p. 35'),
  ('efsa_q28_fibre_ai','dietary_fiber','adult_both_sexes',18,null,25,'g','point',null,null,null,'AI','Adult AI for normal laxation.','EFSA Journal 2010;8(3):1462; https://doi.org/10.2903/j.efsa.2010.1462','Q28; §6.3, p. 36'),
  ('efsa_q29_total_fat_ri','fat','adult_both_sexes',18,null,20,'energy_percent','energy_percent',null,20,35,'RI','Adult RI of total energy. Gram conversion requires an explicitly selected planning-energy basis.','EFSA Journal 2010;8(3):1461; https://doi.org/10.2903/j.efsa.2010.1461','Q29; summary, p. 2'),
  ('efsa_q32_vitamin_e_men_ai','vitamin_e_alpha_tocopherol','adult_male',18,null,13,'mg','point',null,null,null,'AI','Adult AI for alpha-tocopherol, not alpha-tocopherol equivalents.','EFSA Journal 2015;13(7):4149; https://doi.org/10.2903/j.efsa.2015.4149','Q32; abstract and summary'),
  ('efsa_q32_vitamin_e_women_ai','vitamin_e_alpha_tocopherol','adult_female',18,null,11,'mg','point',null,null,null,'AI','Adult AI for alpha-tocopherol, not alpha-tocopherol equivalents.','EFSA Journal 2015;13(7):4149; https://doi.org/10.2903/j.efsa.2015.4149','Q32; abstract and summary'),
  ('efsa_q33_vitamin_k1_ai','vitamin_k1','adult_both_sexes',18,null,70,'µg','point',null,null,null,'AI','Adult AI for phylloquinone (vitamin K1), not total vitamin K or menaquinones.','EFSA Journal 2017;15(5):e04780; https://doi.org/10.2903/j.efsa.2017.4780','Q33; abstract and summary'),
  ('efsa_q34_vitamin_b6_men_pri','vitamin_b6','adult_male',18,null,1.7,'mg','point',null,null,null,'PRI','Adult PRI.','EFSA Journal 2016;14(6):e04485; https://doi.org/10.2903/j.efsa.2016.4485','Q34; abstract, summary and adult sex-specific sections'),
  ('efsa_q34_vitamin_b6_women_pri','vitamin_b6','adult_female',18,null,1.6,'mg','point',null,null,null,'PRI','Adult PRI.','EFSA Journal 2016;14(6):e04485; https://doi.org/10.2903/j.efsa.2016.4485','Q34; abstract, summary and adult sex-specific sections'),
  ('efsa_q35_vitamin_b12_ai','vitamin_b12','adult_both_sexes',18,null,4,'µg','point',null,null,null,'AI','Adult AI; no pregnancy/lactation increment is included in this adult row.','EFSA Journal 2015;13(7):4150; https://doi.org/10.2903/j.efsa.2015.4150','Q35; abstract'),
  ('efsa_q36_vitamin_c_men_pri','vitamin_c','adult_male',18,null,110,'mg','point',null,null,null,'PRI','Adult PRI.','EFSA Journal 2013;11(11):3418; https://doi.org/10.2903/j.efsa.2013.3418','Q36; §6.1, pp. 30–31'),
  ('efsa_q36_vitamin_c_women_pri','vitamin_c','adult_female',18,null,95,'mg','point',null,null,null,'PRI','Adult PRI.','EFSA Journal 2013;11(11):3418; https://doi.org/10.2903/j.efsa.2013.3418','Q36; §6.1, pp. 30–31'),
  ('efsa_q39_magnesium_men_ai','magnesium','adult_male',18,null,350,'mg','point',null,null,null,'AI','Adult AI.','EFSA Journal 2015;13(7):4186; https://doi.org/10.2903/j.efsa.2015.4186','Q39; §6.1, p. 28'),
  ('efsa_q39_magnesium_women_ai','magnesium','adult_female',18,null,300,'mg','point',null,null,null,'AI','Adult AI.','EFSA Journal 2015;13(7):4186; https://doi.org/10.2903/j.efsa.2015.4186','Q39; §6.1, p. 28'),
  ('efsa_q40_sodium_safe_and_adequate','sodium','adult_both_sexes',18,null,2,'g','safe_and_adequate',null,null,null,'safe_adequate','Adult safe and adequate intake. Not an AI, minimum target, or UL; not adoptable as a personal minimum.','EFSA Journal 2019;17(9):5778; https://doi.org/10.2903/j.efsa.2019.5778','Q40; §6.1.3, p. 47'),
  ('efsa_q30_vitamin_a_men_pri','vitamin_a_re','adult_male',18,null,750,'µg','point',null,null,null,'PRI','Healthy-adult PRI in retinol equivalents (RE), not retinol activity equivalents (RAE).','EFSA Journal 2015;13(3):4028; https://doi.org/10.2903/j.efsa.2015.4028','Q30; §6.1, p. 38 and Table 5, p. 39'),
  ('efsa_q30_vitamin_a_women_pri','vitamin_a_re','adult_female',18,null,650,'µg','point',null,null,null,'PRI','Healthy-adult PRI in retinol equivalents (RE), not retinol activity equivalents (RAE).','EFSA Journal 2015;13(3):4028; https://doi.org/10.2903/j.efsa.2015.4028','Q30; §6.1, p. 38 and Table 5, p. 39'),
  ('efsa_q31_vitamin_d_ai','vitamin_d','adult_both_sexes',18,null,15,'µg','point',null,null,null,'AI','Adult AI only under minimal cutaneous synthesis; dietary need may be lower or zero when cutaneous synthesis occurs.','EFSA Journal 2016;14(10):4547; https://doi.org/10.2903/j.efsa.2016.4547','Q31; summary and §6.1, p. 73'),
  ('efsa_q38_calcium_18_24_pri','calcium','adult_both_sexes',18,24,1000,'mg','point',null,null,null,'PRI','Adult PRI at ages 18–24; source does not distinguish by sex.','EFSA Journal 2015;13(5):4101; https://doi.org/10.2903/j.efsa.2015.4101','Q38; §6.3.1, p. 38'),
  ('efsa_q38_calcium_25_plus_pri','calcium','adult_both_sexes',25,null,950,'mg','point',null,null,null,'PRI','Adult PRI from age 25; source does not distinguish by sex.','EFSA Journal 2015;13(5):4101; https://doi.org/10.2903/j.efsa.2015.4101','Q38; §6.3.2, p. 39')
)
insert into public.reference_values(
  reference_pack_id,nutrient_code,cohort,age_min_years,age_max_years,value,unit,reference_kind,target_unit,
  minimum,maximum,reference_type,conditions,source_document,source_locator,immutable_key
)
select pack.id,v.nutrient_code,v.cohort,v.age_min_years,v.age_max_years,v.value,v.unit,v.reference_kind,v.target_unit,
       v.minimum,v.maximum,v.reference_type,v.conditions,v.source_document,v.source_locator,v.immutable_key
from pack cross join values_to_seed v
on conflict(reference_pack_id,immutable_key) do nothing;

commit;
