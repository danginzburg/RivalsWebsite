-- Admin edits to the generated stat records.
--
-- stat_records is wiped and rebuilt on every match import, so edits cannot
-- live there. They are kept here, one row per track and category, and laid
-- over the generated record when the Hall of Fame is read. Deleting a row
-- resets the record to exactly what the stats say.
--
-- Two kinds of field:
--   - presentation (title, description, is_hidden) applies to the category
--     whoever holds it
--   - performance (value_text, unit, holder, team) corrects one specific
--     record, so it applies only while the record is still that performance
--     (base_match_map_id + base_value). When the record is broken, the new
--     holder shows as the stats have it instead of inheriting the correction.

create table if not exists public.stat_record_overrides (
  track text not null,
  category text not null,
  is_hidden boolean not null default false,
  title text,
  description text,
  value_text text,
  unit text,
  profile_id uuid references public.profiles(id) on delete set null,
  player_name text,
  team_id uuid references public.teams(id) on delete set null,
  base_match_map_id uuid,
  base_value double precision,
  updated_by_profile_id uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (track, category)
);

-- Read and written through the service role only.
alter table public.stat_record_overrides enable row level security;
