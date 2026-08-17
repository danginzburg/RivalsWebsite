-- Extend rivals_group_stats backfill to match against profile_riot_accounts.
--
-- The original function only compared a stat row's player_name base to
-- profiles.riot_id_base. Now that a profile can own several Riot names (primary
-- plus alts), rows imported under an alt name must resolve to the owning
-- profile too. This adds a second pass that joins on any approved account name.

create or replace function public.rematch_rivals_group_stats(batch_id uuid default null)
returns table (updated_count integer, remaining_unmatched integer)
language plpgsql
as $$
declare
  v_updated integer := 0;
  v_updated_2 integer := 0;
  v_remaining integer := 0;
begin
  -- Pass 1: legacy match against profiles.riot_id_base (unchanged).
  update public.rivals_group_stats r
  set profile_id = p.id
  from public.profiles p
  where r.profile_id is null
    and p.riot_id_base is not null
    and lower(trim(split_part(r.player_name, '#', 1))) = lower(trim(p.riot_id_base))
    and (batch_id is null or r.import_batch_id = batch_id);

  get diagnostics v_updated = row_count;

  -- Pass 2: match against any approved Riot account name (primary or alt), so
  -- rows imported under an alt/sub name pool into the owning profile.
  update public.rivals_group_stats r
  set profile_id = a.profile_id
  from public.profile_riot_accounts a
  where r.profile_id is null
    and a.status = 'approved'
    and lower(trim(split_part(r.player_name, '#', 1))) = lower(trim(a.riot_name))
    and (batch_id is null or r.import_batch_id = batch_id);

  get diagnostics v_updated_2 = row_count;

  select count(*)
  into v_remaining
  from public.rivals_group_stats r
  where r.profile_id is null
    and (batch_id is null or r.import_batch_id = batch_id);

  updated_count := v_updated + v_updated_2;
  remaining_unmatched := v_remaining;
  return next;
end;
$$;
