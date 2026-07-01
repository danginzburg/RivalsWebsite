alter table public.team_memberships
  add column if not exists is_starter boolean not null default false;
