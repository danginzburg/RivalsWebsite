-- Fill in missing Riot tags.
--
-- Many accounts were recorded by name only: legacy riot_id_base copies, CSV
-- names, and identities linked before the tag was known. Riot match imports
-- store the full `name#tag` on every stat row along with the PUUID, so an
-- account with a PUUID can take its tag from the latest row where it played
-- under the same name. (Names that differ are a rename, not a missing tag, and
-- are left alone.)

with latest as (
  select distinct on (s.puuid)
    s.puuid,
    split_part(s.player_name, '#', 1) as name,
    nullif(trim(split_part(s.player_name, '#', 2)), '') as tag
  from public.player_match_map_stats s
  join public.matches m on m.id = s.match_id
  where s.puuid is not null
    and s.player_name like '%#%'
  order by s.puuid, m.scheduled_at desc nulls last
)
update public.riot_accounts ra
set riot_tag = latest.tag
from latest
where ra.puuid = latest.puuid
  and ra.riot_tag is null
  and latest.tag is not null
  and lower(trim(ra.riot_name)) = lower(trim(latest.name))
  -- An owned Riot ID must stay unique; skip the rare clash.
  and (
    ra.profile_id is null
    or not exists (
      select 1 from public.riot_accounts x
      where x.profile_id is not null
        and x.id <> ra.id
        and lower(x.riot_name) = lower(ra.riot_name)
        and lower(coalesce(x.riot_tag, '')) = lower(latest.tag)
    )
  );
