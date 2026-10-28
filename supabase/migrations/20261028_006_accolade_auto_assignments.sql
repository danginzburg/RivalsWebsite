-- Accolades that follow from a season's recorded results (1st/2nd/3rd place,
-- Finals MVP, Pick'em Champion) are assigned automatically by
-- src/lib/server/accolades/season-sync.ts instead of by hand.
--
-- `source` tells those rows apart from the ones an admin assigned, so a sync
-- can add and retract its own rows without touching manual ones. `season_id`
-- is what a sync matches on; `context` stays the label players see.

alter table public.accolade_assignments
  add column if not exists season_id uuid references public.seasons(id) on delete cascade,
  add column if not exists source text not null default 'manual';

alter table public.accolade_assignments
  drop constraint if exists accolade_assignments_source_check;
alter table public.accolade_assignments
  add constraint accolade_assignments_source_check check (source in ('manual', 'auto'));

-- One automatic award per accolade, player and season.
create unique index if not exists accolade_assignments_auto_unique
  on public.accolade_assignments (accolade_id, profile_id, season_id)
  where source = 'auto';

create index if not exists accolade_assignments_season_idx
  on public.accolade_assignments (season_id)
  where season_id is not null;

-- Hand-assigned rows carry their season only as a "Season 3" label. Pin them
-- to the season they name, so a sync sees the award as already given.
update public.accolade_assignments a
set season_id = s.id
from public.seasons s
where a.season_id is null
  and a.context is not null
  and (
    lower(regexp_replace(trim(a.context), '\s+', ' ', 'g'))
      = lower(regexp_replace(trim(s.name), '\s+', ' ', 'g'))
    or lower(trim(a.context)) = lower(s.code)
  );

-- An admin removing an automatic award records it here, so the next sync
-- does not hand it straight back.
create table if not exists public.accolade_auto_dismissals (
  accolade_id uuid not null references public.accolades(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  season_id uuid not null references public.seasons(id) on delete cascade,
  dismissed_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (accolade_id, profile_id, season_id)
);

alter table public.accolade_auto_dismissals enable row level security;
