-- Pick'em winners get their own accolade. It is assigned by an admin from the
-- accolades tab like every other one; the per-assignment `context` column
-- carries which season it was won in.
insert into public.accolades (name, icon_key)
select 'Pick''em Champion', 'pickem_medal'
where not exists (
  select 1
  from public.accolades
  where name = 'Pick''em Champion'
    and icon_key = 'pickem_medal'
);
