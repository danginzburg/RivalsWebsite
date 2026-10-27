-- Riot accounts follow renames.
--
-- An owned account kept the name it was first recorded under, so a player who
-- renamed in Riot (e.g. skyUndrCoin#10254 -> Sky#Isa, same PUUID) still showed
-- the old name, and adding the new name was refused because its PUUID was
-- already on file. Imports now refresh the name; this applies every rename
-- already sitting in the stats: each PUUID-backed account takes the full
-- name#tag from its most recent Riot-imported map.

with latest as (
  select distinct on (s.puuid)
    s.puuid,
    nullif(trim(split_part(s.player_name, '#', 1)), '') as name,
    nullif(trim(split_part(s.player_name, '#', 2)), '') as tag
  from public.player_match_map_stats s
  join public.matches m on m.id = s.match_id
  where s.puuid is not null
    and s.player_name like '%#%'
  order by s.puuid, m.scheduled_at desc nulls last
)
update public.riot_accounts ra
set riot_name = latest.name,
    riot_tag = latest.tag
from latest
where ra.puuid = latest.puuid
  and latest.name is not null
  and latest.tag is not null
  and (lower(ra.riot_name) <> lower(latest.name)
    or lower(coalesce(ra.riot_tag, '')) <> lower(latest.tag))
  -- An owned Riot ID must stay unique; a name another player still holds on
  -- file is left for the next import to sort out.
  and (
    ra.profile_id is null
    or not exists (
      select 1 from public.riot_accounts x
      where x.profile_id is not null
        and x.id <> ra.id
        and lower(x.riot_name) = lower(latest.name)
        and lower(coalesce(x.riot_tag, '')) = lower(latest.tag)
    )
  );
