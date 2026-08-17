-- Dynamic pick'em: promote the bracket config out of seasons.metadata into
-- dedicated tables so a season can run either a playoff bracket or a flat set
-- of weekly matchups through one engine.

-- One pick'em per season (bracket or matchups).
create table if not exists public.pickem_events (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references public.seasons(id) on delete cascade,
  format text not null default 'bracket' check (format in ('bracket', 'matchups')),
  title text not null default '',
  status text not null default 'draft' check (status in ('draft', 'open', 'locked', 'scored')),
  lock_at timestamptz,
  -- Format-specific extras. For brackets: { "seeds": [{ "seed": n, "teamId": uuid }] }.
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (season_id)
);

-- The generic prediction units, for both formats.
create table if not exists public.pickem_matches (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.pickem_events(id) on delete cascade,
  -- Stable id within the event; the key used in submission payloads.
  slot_key text not null,
  group_key text not null default '',
  sort_order integer not null default 0,
  label text not null default '',
  points integer not null default 1,
  -- Assigned directly (matchups) or left null and derived from feed_a/feed_b (bracket).
  team_a_id uuid references public.teams(id) on delete set null,
  team_b_id uuid references public.teams(id) on delete set null,
  -- Bracket topology: null | {"type":"seed","seed":n}
  --                        | {"type":"winner","of":"slot_key"}
  --                        | {"type":"loser","of":"slot_key"}
  feed_a jsonb,
  feed_b jsonb,
  -- The real match whose result decides this unit's actual winner.
  linked_match_id uuid references public.matches(id) on delete set null,
  -- Admin hard-resolved winner: pre-concluded, excluded from scoring.
  actual_winner_id uuid references public.teams(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (event_id, slot_key)
);

create index if not exists pickem_events_season_idx on public.pickem_events(season_id);
create index if not exists pickem_matches_event_idx on public.pickem_matches(event_id);

-- Submissions gain an event scope. season_id stays for convenient filtering.
alter table public.pickem_submissions
  add column if not exists event_id uuid references public.pickem_events(id) on delete cascade;

create index if not exists pickem_submissions_event_idx on public.pickem_submissions(event_id);

-- updated_at triggers
drop trigger if exists set_updated_at_pickem_events on public.pickem_events;
create trigger set_updated_at_pickem_events
before update on public.pickem_events
for each row execute function public.set_updated_at();

drop trigger if exists set_updated_at_pickem_matches on public.pickem_matches;
create trigger set_updated_at_pickem_matches
before update on public.pickem_matches
for each row execute function public.set_updated_at();

-- RLS: anyone may read a pick'em; only admins may edit it.
alter table public.pickem_events enable row level security;
alter table public.pickem_matches enable row level security;

drop policy if exists pickem_events_read_all on public.pickem_events;
create policy pickem_events_read_all
  on public.pickem_events for select
  using (true);

drop policy if exists pickem_events_write_admin on public.pickem_events;
create policy pickem_events_write_admin
  on public.pickem_events for all
  to authenticated
  using (public.is_current_user_admin())
  with check (public.is_current_user_admin());

drop policy if exists pickem_matches_read_all on public.pickem_matches;
create policy pickem_matches_read_all
  on public.pickem_matches for select
  using (true);

drop policy if exists pickem_matches_write_admin on public.pickem_matches;
create policy pickem_matches_write_admin
  on public.pickem_matches for all
  to authenticated
  using (public.is_current_user_admin())
  with check (public.is_current_user_admin());

-- ---------------------------------------------------------------------------
-- Data migration: move every enabled season bracket in seasons.metadata into
-- the new tables, then repoint its submissions at the created event.
-- ---------------------------------------------------------------------------

insert into public.pickem_events (season_id, format, title, status, lock_at, config)
select
  s.id,
  'bracket',
  coalesce(nullif(s.name, ''), 'Playoffs'),
  coalesce(s.metadata -> 'playoff_pickem' ->> 'status', 'draft'),
  nullif(s.metadata -> 'playoff_pickem' ->> 'lock_at', '')::timestamptz,
  jsonb_build_object('seeds', coalesce(s.metadata -> 'playoff_pickem' -> 'seeds', '[]'::jsonb))
from public.seasons s
where coalesce((s.metadata -> 'playoff_pickem' ->> 'enabled')::boolean, false) = true
  and not exists (select 1 from public.pickem_events e where e.season_id = s.id);

-- The standard 8-team double-elimination template (mirrors
-- standardDoubleElim8Template() in src/lib/pickems.ts), with each slot's real
-- match link and any admin-resolved winner pulled from the old metadata.
with tmpl(slot_key, group_key, sort_order, label, points, feed_a, feed_b) as (
  values
    ('ub_qf_1','Upper QF',0,'Upper QF 1',1,'{"type":"seed","seed":1}'::jsonb,'{"type":"seed","seed":8}'::jsonb),
    ('ub_qf_2','Upper QF',1,'Upper QF 2',1,'{"type":"seed","seed":4}'::jsonb,'{"type":"seed","seed":5}'::jsonb),
    ('ub_qf_3','Upper QF',2,'Upper QF 3',1,'{"type":"seed","seed":2}'::jsonb,'{"type":"seed","seed":7}'::jsonb),
    ('ub_qf_4','Upper QF',3,'Upper QF 4',1,'{"type":"seed","seed":3}'::jsonb,'{"type":"seed","seed":6}'::jsonb),
    ('ub_sf_1','Upper SF',4,'Upper SF 1',2,'{"type":"winner","of":"ub_qf_1"}'::jsonb,'{"type":"winner","of":"ub_qf_2"}'::jsonb),
    ('ub_sf_2','Upper SF',5,'Upper SF 2',2,'{"type":"winner","of":"ub_qf_3"}'::jsonb,'{"type":"winner","of":"ub_qf_4"}'::jsonb),
    ('ub_final','Upper Final',6,'Upper Final',3,'{"type":"winner","of":"ub_sf_1"}'::jsonb,'{"type":"winner","of":"ub_sf_2"}'::jsonb),
    ('lb_r1_1','Lower R1',7,'Lower R1 1',2,'{"type":"loser","of":"ub_qf_1"}'::jsonb,'{"type":"loser","of":"ub_qf_2"}'::jsonb),
    ('lb_r1_2','Lower R1',8,'Lower R1 2',2,'{"type":"loser","of":"ub_qf_3"}'::jsonb,'{"type":"loser","of":"ub_qf_4"}'::jsonb),
    ('lb_r2_1','Lower R2',9,'Lower R2 1',2,'{"type":"loser","of":"ub_sf_1"}'::jsonb,'{"type":"winner","of":"lb_r1_1"}'::jsonb),
    ('lb_r2_2','Lower R2',10,'Lower R2 2',2,'{"type":"loser","of":"ub_sf_2"}'::jsonb,'{"type":"winner","of":"lb_r1_2"}'::jsonb),
    ('lb_r3','Lower R3',11,'Lower Round 3',2,'{"type":"winner","of":"lb_r2_1"}'::jsonb,'{"type":"winner","of":"lb_r2_2"}'::jsonb),
    ('lb_final','Lower Final',12,'Lower Final',3,'{"type":"loser","of":"ub_final"}'::jsonb,'{"type":"winner","of":"lb_r3"}'::jsonb),
    ('grand_final','Grand Final',13,'Grand Final',5,'{"type":"winner","of":"ub_final"}'::jsonb,'{"type":"winner","of":"lb_final"}'::jsonb)
)
insert into public.pickem_matches (
  event_id, slot_key, group_key, sort_order, label, points, feed_a, feed_b,
  linked_match_id, actual_winner_id
)
select
  e.id, t.slot_key, t.group_key, t.sort_order, t.label, t.points, t.feed_a, t.feed_b,
  (
    select nullif(ml ->> 'actualMatchId', '')::uuid
    from jsonb_array_elements(coalesce(s.metadata -> 'playoff_pickem' -> 'match_links', '[]'::jsonb)) ml
    where ml ->> 'matchId' = t.slot_key
    limit 1
  ),
  (
    select nullif(rm ->> 'winnerId', '')::uuid
    from jsonb_array_elements(coalesce(s.metadata -> 'playoff_pickem' -> 'resolved_matches', '[]'::jsonb)) rm
    where rm ->> 'matchId' = t.slot_key
    limit 1
  )
from public.pickem_events e
join public.seasons s on s.id = e.season_id
cross join tmpl t
where e.format = 'bracket'
  and not exists (select 1 from public.pickem_matches m where m.event_id = e.id);

update public.pickem_submissions ps
set event_id = e.id
from public.pickem_events e
where e.season_id = ps.season_id
  and ps.kind = 'playoff_bracket'
  and ps.event_id is null;

-- `kind` now mirrors the event format instead of naming one fixed bracket.
alter table public.pickem_submissions
  drop constraint if exists pickem_submissions_kind_check;

update public.pickem_submissions
  set kind = 'bracket'
  where kind = 'playoff_bracket';

alter table public.pickem_submissions
  add constraint pickem_submissions_kind_check
  check (kind in ('final_buckets', 'bracket', 'matchups'));
