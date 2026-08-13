-- Per-season branding. Stored in the existing team-logos bucket rather than a
-- new one, since the access rules are identical.

alter table public.seasons
  add column if not exists logo_path text;
