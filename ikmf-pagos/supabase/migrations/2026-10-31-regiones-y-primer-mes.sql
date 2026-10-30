-- =====================================================================
-- IKMF Pagos — regiones de países + primer mes de cobro por país
-- Correr una vez en Supabase → SQL Editor. Se puede volver a correr.
-- =====================================================================

alter table public.countries add column if not exists region text
  check (region is null or region in ('latam', 'north_america', 'europe', 'asia', 'africa', 'oceania'));
alter table public.countries add column if not exists first_month date
  check (first_month is null or extract(day from first_month) = 1);

-- Región según el código ISO del país (solo donde todavía no tiene una).
update public.countries set region = case
  when code in ('AR','BO','BR','CL','CO','CR','CU','DO','EC','GT','HN','MX','NI','PA','PE','PR','PY','SV','UY','VE','BZ','HT','JM','TT','GY','SR','BS','BB')
    then 'latam'
  when code in ('US','CA') then 'north_america'
  when code in ('ES','PT','FR','IT','DE','GB','UK','IE','NL','BE','LU','CH','AT','PL','CZ','SK','HU','RO','BG','GR','SE','NO','DK','FI','IS','EE','LV','LT','UA','BY','MD','RS','HR','SI','BA','ME','MK','AL','CY','MT','RU')
    then 'europe'
  when code in ('IL','TR','IN','CN','JP','KR','TH','VN','PH','ID','MY','SG','AE','SA','QA','KW','BH','OM','JO','LB','GE','AM','AZ','KZ','UZ','PK','BD','LK','NP','HK','TW','MN','KH','LA','MM')
    then 'asia'
  when code in ('ZA','EG','MA','DZ','TN','NG','KE','GH','ET','TZ','UG','SN','CI','CM','AO','MZ','ZW','ZM','NA','BW','RW','MU','MG')
    then 'africa'
  when code in ('AU','NZ','FJ','PG') then 'oceania'
end
where region is null;

-- Argentina: el primer mes que se cobra es noviembre de 2026.
update public.countries set first_month = '2026-11-01' where code = 'AR';

select name, code, region, first_month from public.countries order by region nulls last, name;
