insert into public.accolades (name, icon_key)
select 'MVP', 'trophy'
where not exists (
  select 1
  from public.accolades
  where name = 'MVP'
    and icon_key = 'trophy'
);
