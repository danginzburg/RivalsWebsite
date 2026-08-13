-- Hall of Fame: admin-curated records, moments, and awards.

create table if not exists public.hall_of_fame_entries (
  id uuid primary key default gen_random_uuid(),
  -- 'record'  = a statistical high-water mark (most kills in a map, highest ACS, ...)
  -- 'moment'  = a highlight worth remembering, optionally with a clip link
  -- 'award'   = a title earned (season champion, MVP, ...)
  entry_type text not null default 'record'
    check (entry_type in ('record', 'moment', 'award')),
  title text not null,
  description text,
  -- Displayed alongside the title for records, e.g. "42" with stat_label "kills".
  stat_value text,
  stat_label text,
  -- Optional links. media_url is any external clip/VOD; image_path is Supabase storage.
  media_url text,
  image_path text,
  -- Optional attributions. All nullable so an entry can honor a team, a player,
  -- both, or neither.
  profile_id uuid references public.profiles(id) on delete set null,
  team_id uuid references public.teams(id) on delete set null,
  season_id uuid references public.seasons(id) on delete set null,
  -- Free-text fallback when the honoree has no profile row yet.
  player_name text,
  is_published boolean not null default true,
  sort_order integer not null default 0,
  created_by_profile_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists hall_of_fame_type_idx on public.hall_of_fame_entries(entry_type);
create index if not exists hall_of_fame_season_idx on public.hall_of_fame_entries(season_id);
create index if not exists hall_of_fame_profile_idx on public.hall_of_fame_entries(profile_id);
create index if not exists hall_of_fame_sort_idx on public.hall_of_fame_entries(sort_order);

drop trigger if exists hall_of_fame_entries_set_updated_at on public.hall_of_fame_entries;
create trigger hall_of_fame_entries_set_updated_at
  before update on public.hall_of_fame_entries
  for each row execute function public.set_updated_at();

alter table public.hall_of_fame_entries enable row level security;

-- Published entries are public; writes go through the service role only.
drop policy if exists "hall_of_fame_select" on public.hall_of_fame_entries;
create policy "hall_of_fame_select" on public.hall_of_fame_entries
  for select using (is_published = true);
