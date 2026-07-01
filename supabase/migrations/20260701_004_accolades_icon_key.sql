alter table public.accolades
  add column if not exists icon_key text;

insert into public.accolades (name, icon_key) values
  ('1st Place', 'gold_medal'),
  ('2nd Place', 'silver_medal'),
  ('3rd Place', 'bronze_medal');
