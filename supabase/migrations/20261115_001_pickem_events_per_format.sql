-- A season can run a playoff bracket AND weekly matchups side by side, so the
-- pick'em page shows past weekly picks next to the bracket and both count
-- toward the season total. One event per format per season (submissions are
-- already unique per season/profile/kind, and kind mirrors the format).

do $$
declare
  constraint_name text;
begin
  -- Drop the old one-event-per-season unique, whatever it was named.
  for constraint_name in
    select c.conname
    from pg_constraint c
    where c.conrelid = 'public.pickem_events'::regclass
      and c.contype = 'u'
      and c.conkey = array[
        (select attnum from pg_attribute
          where attrelid = 'public.pickem_events'::regclass and attname = 'season_id')
      ]::smallint[]
  loop
    execute format('alter table public.pickem_events drop constraint %I', constraint_name);
  end loop;
end $$;

alter table public.pickem_events
  drop constraint if exists pickem_events_season_format_key;

alter table public.pickem_events
  add constraint pickem_events_season_format_key unique (season_id, format);
