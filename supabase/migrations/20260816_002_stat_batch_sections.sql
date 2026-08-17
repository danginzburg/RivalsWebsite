-- Sections for stat batches, and the match stage that feeds a generated one.
--
-- `matches.stage` has existed since the competition core migration but was
-- never written to. It becomes the filter the batch generator scopes on
-- (kickoff / regular / playins / playoffs), and `stat_import_batches.section`
-- is where the resulting batch shows up in the stats picker.
--
-- Keys must stay in sync with src/lib/stats/sections.ts.

alter table public.stat_import_batches
  add column if not exists section text;

create index if not exists stat_import_batches_section_idx
  on public.stat_import_batches(section);

create index if not exists matches_stage_idx on public.matches(stage);

-- Backfill batch sections from the display names we already have. The name
-- patterns are inconsistent across seasons on purpose here: Season 4 used
-- square brackets where earlier seasons used parentheses, so match on the
-- stage word alone. Anything unrecognised is left NULL and falls back to
-- name inference at read time.
update public.stat_import_batches
set section = case
  when display_name ~* 'all[[:space:]-]?time' then 'alltime'
  when display_name ~* 'play[[:space:]-]?off|post[[:space:]-]?season|grand[[:space:]-]?final' then 'playoffs'
  when display_name ~* 'play[[:space:]-]?in|qualifier' then 'playins'
  when display_name ~* 'kick[[:space:]-]?off' then 'kickoff'
  when import_kind = 'weekly' or week_label is not null or display_name ~* '(^|[^a-z])weeks?([^a-z]|$)' then 'weeks'
  when display_name ~* 'season[[:space:]]*[0-9]' then 'regular'
  else null
end
where section is null
  and metadata->>'import_type' = 'rivals_group_stats';

-- Backfill match stages from the free-text designation admins already enter
-- ("Grand Finals", "Week 3", "Play-in Round 1"). Matches with no designation
-- stay NULL; the generator treats those as unfiled rather than guessing.
update public.matches
set stage = case
  when metadata->>'designation' ~* 'play[[:space:]-]?off|grand[[:space:]-]?final|semi[[:space:]-]?final|quarter[[:space:]-]?final|bracket' then 'playoffs'
  when metadata->>'designation' ~* 'play[[:space:]-]?in|qualifier' then 'playins'
  when metadata->>'designation' ~* 'kick[[:space:]-]?off' then 'kickoff'
  when metadata->>'designation' ~* '(^|[^a-z])weeks?([^a-z]|$)|regular|group stage|round robin' then 'regular'
  else null
end
where stage is null
  and coalesce(metadata->>'designation', '') <> '';
