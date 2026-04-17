-- Rebuild a generated rivals_group_stats import batch from metadata.source_season_batches.
--
-- How to use (Supabase SQL editor):
-- 1) Edit v_target_batch_id below (your generated batch UUID, e.g. All Time (NA)).
-- 2) Ensure that batch row has:
--      metadata.import_type = 'rivals_group_stats'
--      metadata.source_season_batches = ['uuid', ...]   (the source batches to aggregate)
-- 3) Run this single statement once.
--
-- What it does:
-- - Validates every UUID in metadata.source_season_batches exists and is an applied rivals_group_stats batch
-- - Refuses to run if the target batch id is included in source_season_batches (prevents self-aggregation)
-- - Deletes all existing rivals_group_stats rows for the target batch
-- - Inserts freshly aggregated rows for the target batch
-- - Updates stat_import_batches row_count / accepted_count / rejected_count for the target batch
--
-- Note: This must be ONE statement for clients that execute SQL via prepared statements (including supabase db query).

do $$
declare
  v_target_batch_id uuid := '9bbbf1c1-0a57-4f7c-b0c5-3e1a3f5f05c6'::uuid;
  v_uploaded_by uuid;
  v_metadata jsonb;
  v_source_ids uuid[];
  v_inserted integer;
begin
  select b.uploaded_by_profile_id, b.metadata
    into v_uploaded_by, v_metadata
  from public.stat_import_batches b
  where b.id = v_target_batch_id;

  if not found then
    raise exception 'stat_import_batches row not found for id %', v_target_batch_id;
  end if;

  if coalesce(v_metadata->>'import_type', '') <> 'rivals_group_stats' then
    raise exception 'Target batch % metadata.import_type must be rivals_group_stats (got %)',
      v_target_batch_id, coalesce(v_metadata->>'import_type', '<null>');
  end if;

  select coalesce(array_agg(distinct x.id), '{}'::uuid[])
    into v_source_ids
  from (
    select (jsonb_array_elements_text(coalesce(v_metadata->'source_season_batches', '[]'::jsonb)))::uuid as id
  ) x
  where x.id is not null;

  if coalesce(cardinality(v_source_ids), 0) = 0 then
    raise exception 'metadata.source_season_batches is missing/empty for batch %', v_target_batch_id;
  end if;

  if v_target_batch_id = any (v_source_ids) then
    raise exception 'metadata.source_season_batches must not include the target batch id (%).', v_target_batch_id;
  end if;

  if exists (
    select 1
    from unnest(v_source_ids) s(id)
    left join public.stat_import_batches b
      on b.id = s.id
     and b.status = 'applied'
     and coalesce(b.metadata->>'import_type', '') = 'rivals_group_stats'
    where b.id is null
  ) then
    raise exception 'One or more source_season_batches UUIDs are missing, not applied, or not rivals_group_stats imports.';
  end if;

  delete from public.rivals_group_stats r
  where r.import_batch_id = v_target_batch_id;

  insert into public.rivals_group_stats (
    player_name,
    profile_id,
    agents,
    games,
    games_won,
    games_lost,
    rounds,
    rounds_won,
    rounds_lost,
    acs,
    kd,
    kast_pct,
    adr,
    kills,
    kpg,
    kpr,
    deaths,
    dpg,
    dpr,
    assists,
    apg,
    apr,
    fk,
    fkpg,
    fd,
    fdpg,
    hs_pct,
    plants,
    plants_per_game,
    defuses,
    defuses_per_game,
    econ_rating,
    import_batch_id,
    imported_by_profile_id,
    imported_at
  )
  with base as (
    select
      r.import_batch_id,
      coalesce(sb.display_name, sb.source_filename, sb.id::text) as batch_label,
      sb.created_at as batch_created_at,
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
    join public.stat_import_batches sb on sb.id = r.import_batch_id
    where r.import_batch_id = any (v_source_ids)
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
      (min(profile_id::text) filter (where profile_id is not null))::uuid as profile_id,
      (array_agg(player_name order by coalesce(games, 0) desc, coalesce(rounds, 0) desc, player_name))[1] as player_name,
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
    a.player_name,
    a.profile_id,
    nullif(btrim(coalesce(ag.agents, '')), '') as agents,
    a.games,
    a.games_won,
    a.games_lost,
    a.rounds,
    a.rounds_won,
    a.rounds_lost,
    a.acs,
    a.kd,
    a.kast_pct,
    a.adr,
    a.kills,
    a.kpg,
    a.kpr,
    a.deaths,
    a.dpg,
    a.dpr,
    a.assists,
    a.apg,
    a.apr,
    a.fk,
    a.fkpg,
    a.fd,
    a.fdpg,
    a.hs_pct,
    a.plants,
    a.plants_per_game,
    a.defuses,
    a.defuses_per_game,
    a.econ_rating,
    v_target_batch_id as import_batch_id,
    v_uploaded_by as imported_by_profile_id,
    now() as imported_at
  from aggregated a
  left join agents_agg ag on ag.player_key = a.player_key;

  get diagnostics v_inserted = row_count;

  update public.stat_import_batches b
  set
    row_count = v_inserted,
    accepted_count = v_inserted,
    rejected_count = 0,
    updated_at = now()
  where b.id = v_target_batch_id;

  raise notice 'Rebuilt rivals_group_stats for batch %: % rows inserted', v_target_batch_id, v_inserted;
end $$;
