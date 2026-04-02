-- Backfill rivals_group_stats.profile_id after Riot IDs are set.

create or replace function public.rematch_rivals_group_stats(batch_id uuid default null)
returns table (updated_count integer, remaining_unmatched integer)
language plpgsql
as $$
declare
  v_updated integer := 0;
  v_remaining integer := 0;
begin
  -- Match rows where profile_id is still null by comparing player_name base
  -- (name before #) to profiles.riot_id_base (case-insensitive).
  update public.rivals_group_stats r
  set profile_id = p.id
  from public.profiles p
  where r.profile_id is null
    and p.riot_id_base is not null
    and lower(trim(split_part(r.player_name, '#', 1))) = lower(trim(p.riot_id_base))
    and (batch_id is null or r.import_batch_id = batch_id);

  get diagnostics v_updated = row_count;

  select count(*)
  into v_remaining
  from public.rivals_group_stats r
  where r.profile_id is null
    and (batch_id is null or r.import_batch_id = batch_id);

  updated_count := v_updated;
  remaining_unmatched := v_remaining;
  return next;
end;
$$;
