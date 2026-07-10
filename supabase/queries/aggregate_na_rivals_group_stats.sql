-- Aggregate applied NA rivals_group_stats batches for Seasons 1-4, including playoffs.
-- This intentionally excludes generated rows like "All Time (NA)" by only selecting
-- batch display names shaped like "Season N (NA)" or "Season N Playoffs (NA)".
--
-- If you want to materialize a generated batch (delete + insert rows) using
-- metadata.source_season_batches, use `supabase/queries/refresh_generated_rivals_group_stats_batch.sql`.
with selected_batches as (
  select
    b.id,
    b.display_name,
    ((regexp_match(
      coalesce(b.display_name, ''),
      '^Season[[:space:]]+([1-4])(?:[[:space:]]+Playoffs)?[[:space:]]+\(NA\)$',
      'i'
    ))[1])::integer as season_number,
    coalesce(b.display_name, '') ~* '[[:space:]]+Playoffs[[:space:]]+\(NA\)$' as is_playoffs
  from public.stat_import_batches b
  where b.status = 'applied'
    and coalesce(b.metadata->>'import_type', '') = 'rivals_group_stats'
    and coalesce(b.display_name, '') ~* '^Season[[:space:]]+[1-4](?:[[:space:]]+Playoffs)?[[:space:]]+\(NA\)$'
),
base as (
  select
    r.import_batch_id,
    sb.display_name as batch_name,
    sb.season_number,
    sb.is_playoffs,
    coalesce(r.profile_id::text, lower(trim(r.player_name))) as player_key,
    r.profile_id,
    r.player_name,
    r.agents,
    coalesce(nullif(r.rounds, 0), nullif(r.games, 0), 0)::double precision as avg_weight,
    r.games,
    r.games_won,
    r.games_lost,
    r.rounds,
    r.rounds_won,
    r.rounds_lost,
    r.kills,
    r.deaths,
    r.assists,
    r.fk,
    r.fd,
    r.plants,
    r.defuses,
    r.acs,
    r.kast_pct,
    r.adr,
    r.hs_pct,
    r.econ_rating
  from public.rivals_group_stats r
  join selected_batches sb on sb.id = r.import_batch_id
),
agent_tokens as (
  select distinct on (b.player_key, lower(t.token))
    b.player_key,
    btrim(t.token) as agent_label
  from base b
  cross join lateral regexp_split_to_table(coalesce(b.agents, ''), '\s+') as t(token)
  where btrim(t.token) <> ''
),
agents_agg as (
  select
    player_key,
    string_agg(agent_label, ' ' order by lower(agent_label)) as agents
  from agent_tokens
  group by player_key
),
aggregated as (
  select
    player_key,
    min(profile_id::text) filter (where profile_id is not null) as profile_id,
    (array_agg(player_name order by coalesce(games, 0) desc, coalesce(rounds, 0) desc, player_name))[1] as player_name,
    jsonb_agg(batch_name order by season_number, is_playoffs, batch_name) as source_batches,
    count(*)::integer as source_batch_rows,
    coalesce(sum(games), 0)::integer as games,
    coalesce(sum(games_won), 0)::integer as games_won,
    coalesce(sum(games_lost), 0)::integer as games_lost,
    coalesce(sum(rounds), 0)::integer as rounds,
    coalesce(sum(rounds_won), 0)::integer as rounds_won,
    coalesce(sum(rounds_lost), 0)::integer as rounds_lost,
    coalesce(sum(kills), 0)::integer as kills,
    coalesce(sum(deaths), 0)::integer as deaths,
    coalesce(sum(assists), 0)::integer as assists,
    coalesce(sum(fk), 0)::integer as fk,
    coalesce(sum(fd), 0)::integer as fd,
    coalesce(sum(plants), 0)::integer as plants,
    coalesce(sum(defuses), 0)::integer as defuses,
    sum(kills)::double precision / nullif(sum(deaths), 0) as kd,
    sum(kills)::double precision / nullif(sum(games), 0) as kpg,
    sum(kills)::double precision / nullif(sum(rounds), 0) as kpr,
    sum(deaths)::double precision / nullif(sum(games), 0) as dpg,
    sum(deaths)::double precision / nullif(sum(rounds), 0) as dpr,
    sum(assists)::double precision / nullif(sum(games), 0) as apg,
    sum(assists)::double precision / nullif(sum(rounds), 0) as apr,
    sum(fk)::double precision / nullif(sum(games), 0) as fkpg,
    sum(fd)::double precision / nullif(sum(games), 0) as fdpg,
    sum(plants)::double precision / nullif(sum(games), 0) as plants_per_game,
    sum(defuses)::double precision / nullif(sum(games), 0) as defuses_per_game,
    sum(acs * avg_weight) / nullif(sum(avg_weight), 0) as acs,
    sum(kast_pct * avg_weight) / nullif(sum(avg_weight), 0) as kast_pct,
    sum(adr * avg_weight) / nullif(sum(avg_weight), 0) as adr,
    sum(hs_pct * avg_weight) / nullif(sum(avg_weight), 0) as hs_pct,
    sum(econ_rating * avg_weight) / nullif(sum(avg_weight), 0) as econ_rating
  from base
  group by player_key
)
select
  a.player_key,
  a.profile_id,
  a.player_name,
  nullif(btrim(coalesce(ag.agents, '')), '') as agents,
  a.source_batches,
  a.source_batch_rows,
  a.games,
  a.games_won,
  a.games_lost,
  a.rounds,
  a.rounds_won,
  a.rounds_lost,
  a.kills,
  a.deaths,
  a.assists,
  a.fk,
  a.fd,
  a.plants,
  a.defuses,
  a.acs,
  a.kd,
  a.kast_pct,
  a.adr,
  a.hs_pct,
  a.econ_rating,
  a.kpg,
  a.kpr,
  a.dpg,
  a.dpr,
  a.apg,
  a.apr,
  a.fkpg,
  a.fdpg,
  a.plants_per_game,
  a.defuses_per_game
from aggregated a
left join agents_agg ag on ag.player_key = a.player_key
order by a.acs desc nulls last, a.kills desc, a.player_name asc;
