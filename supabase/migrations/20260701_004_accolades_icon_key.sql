alter table public.accolades
  add column if not exists icon_key text;

insert into public.accolades (name, icon_key)
select seed.name, seed.icon_key
from (values
  ('1st Place', 'gold_medal'),
  ('2nd Place', 'silver_medal'),
  ('3rd Place', 'bronze_medal')
) as seed(name, icon_key)
where not exists (
  select 1
  from public.accolades existing
  where existing.name = seed.name
    and existing.icon_key = seed.icon_key
);
