create table if not exists public.pickem_submissions (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references public.seasons(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null default 'final_buckets' check (kind in ('final_buckets')),
  payload jsonb not null default '{}'::jsonb,
  score integer not null default 0,
  scored_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (season_id, profile_id, kind)
);

create index if not exists pickem_submissions_season_idx on public.pickem_submissions(season_id);
create index if not exists pickem_submissions_profile_idx on public.pickem_submissions(profile_id);

drop trigger if exists set_updated_at_pickem_submissions on public.pickem_submissions;
create trigger set_updated_at_pickem_submissions
before update on public.pickem_submissions
for each row execute function public.set_updated_at();

alter table public.pickem_submissions enable row level security;

drop policy if exists pickem_submissions_read_own on public.pickem_submissions;
create policy pickem_submissions_read_own
  on public.pickem_submissions
  for select
  to authenticated
  using (profile_id = public.current_profile_id() or public.is_current_user_admin());

drop policy if exists pickem_submissions_write_own on public.pickem_submissions;
create policy pickem_submissions_write_own
  on public.pickem_submissions
  for insert
  to authenticated
  with check (profile_id = public.current_profile_id() or public.is_current_user_admin());

drop policy if exists pickem_submissions_update_own on public.pickem_submissions;
create policy pickem_submissions_update_own
  on public.pickem_submissions
  for update
  to authenticated
  using (profile_id = public.current_profile_id() or public.is_current_user_admin())
  with check (profile_id = public.current_profile_id() or public.is_current_user_admin());

drop policy if exists pickem_submissions_delete_admin on public.pickem_submissions;
create policy pickem_submissions_delete_admin
  on public.pickem_submissions
  for delete
  to authenticated
  using (public.is_current_user_admin());
