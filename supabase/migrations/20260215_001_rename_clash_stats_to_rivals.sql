-- Rename stats tables from clash_* to rivals_*.
-- Safe to run multiple times.

do $$
begin
  if to_regclass('public.clash_group_stats') is not null and to_regclass('public.rivals_group_stats') is null then
    alter table public.clash_group_stats rename to rivals_group_stats;

    -- Rename indexes for clarity (optional).
    if to_regclass('public.clash_group_stats_player_idx') is not null then
      alter index public.clash_group_stats_player_idx rename to rivals_group_stats_player_idx;
    end if;
    if to_regclass('public.clash_group_stats_profile_idx') is not null then
      alter index public.clash_group_stats_profile_idx rename to rivals_group_stats_profile_idx;
    end if;
    if to_regclass('public.clash_group_stats_batch_idx') is not null then
      alter index public.clash_group_stats_batch_idx rename to rivals_group_stats_batch_idx;
    end if;
  end if;
end $$;
