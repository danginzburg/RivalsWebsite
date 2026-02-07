-- RLS hardening for competition tables.

create or replace function public.current_profile_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select p.id
  from public.profiles p
  where p.auth0_sub = coalesce(auth.jwt() ->> 'sub', '')
  limit 1;
$$;

create or replace function public.is_current_user_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = public.current_profile_id()
      and p.role = 'admin'
  );
$$;

grant execute on function public.current_profile_id() to anon, authenticated;
grant execute on function public.is_current_user_admin() to anon, authenticated;

alter table public.seasons enable row level security;
alter table public.teams enable row level security;
alter table public.team_memberships enable row level security;
alter table public.team_invites enable row level security;
alter table public.free_agent_listings enable row level security;
alter table public.match_proposals enable row level security;
alter table public.matches enable row level security;
alter table public.match_map_veto_actions enable row level security;
alter table public.match_streams enable row level security;
alter table public.player_match_stats enable row level security;
alter table public.stat_import_batches enable row level security;
alter table public.stat_import_errors enable row level security;
alter table public.leaderboard_entries enable row level security;

drop policy if exists seasons_read on public.seasons;
create policy seasons_read
  on public.seasons
  for select
  to anon, authenticated
  using (true);

drop policy if exists teams_read_approved on public.teams;
create policy teams_read_approved
  on public.teams
  for select
  to anon, authenticated
  using (approval_status = 'approved' or submitted_by_profile_id = public.current_profile_id() or public.is_current_user_admin());

drop policy if exists teams_insert_own_draft on public.teams;
create policy teams_insert_own_draft
  on public.teams
  for insert
  to authenticated
  with check (
    submitted_by_profile_id = public.current_profile_id()
    and approval_status = 'pending'
  );

drop policy if exists teams_update_admin_or_owner_draft on public.teams;
create policy teams_update_admin_or_owner_draft
  on public.teams
  for update
  to authenticated
  using (
    public.is_current_user_admin()
    or (submitted_by_profile_id = public.current_profile_id() and approval_status in ('pending', 'rejected'))
  )
  with check (
    public.is_current_user_admin()
    or (submitted_by_profile_id = public.current_profile_id() and approval_status in ('pending', 'rejected'))
  );

drop policy if exists team_memberships_read on public.team_memberships;
create policy team_memberships_read
  on public.team_memberships
  for select
  to anon, authenticated
  using (
    exists (
      select 1
      from public.teams t
      where t.id = team_memberships.team_id
        and t.approval_status = 'approved'
    )
    or profile_id = public.current_profile_id()
    or public.is_current_user_admin()
  );

drop policy if exists team_memberships_write_admin on public.team_memberships;
create policy team_memberships_write_admin
  on public.team_memberships
  for all
  to authenticated
  using (public.is_current_user_admin())
  with check (public.is_current_user_admin());

drop policy if exists team_invites_read on public.team_invites;
create policy team_invites_read
  on public.team_invites
  for select
  to authenticated
  using (
    invited_profile_id = public.current_profile_id()
    or invited_by_profile_id = public.current_profile_id()
    or public.is_current_user_admin()
  );

drop policy if exists team_invites_write_admin on public.team_invites;
create policy team_invites_write_admin
  on public.team_invites
  for all
  to authenticated
  using (public.is_current_user_admin())
  with check (public.is_current_user_admin());

drop policy if exists free_agent_read_active on public.free_agent_listings;
create policy free_agent_read_active
  on public.free_agent_listings
  for select
  to anon, authenticated
  using (status = 'active' or profile_id = public.current_profile_id() or public.is_current_user_admin());

drop policy if exists free_agent_write_owner on public.free_agent_listings;
create policy free_agent_write_owner
  on public.free_agent_listings
  for all
  to authenticated
  using (profile_id = public.current_profile_id() or public.is_current_user_admin())
  with check (profile_id = public.current_profile_id() or public.is_current_user_admin());

drop policy if exists match_proposals_read on public.match_proposals;
create policy match_proposals_read
  on public.match_proposals
  for select
  to authenticated
  using (
    public.is_current_user_admin()
    or exists (
      select 1
      from public.team_memberships tm
      where tm.team_id in (match_proposals.proposed_by_team_id, match_proposals.opponent_team_id)
        and tm.profile_id = public.current_profile_id()
        and tm.is_active = true
        and tm.left_at is null
    )
  );

drop policy if exists match_proposals_write_admin on public.match_proposals;
create policy match_proposals_write_admin
  on public.match_proposals
  for all
  to authenticated
  using (public.is_current_user_admin())
  with check (public.is_current_user_admin());

drop policy if exists matches_read_approved on public.matches;
create policy matches_read_approved
  on public.matches
  for select
  to anon, authenticated
  using (approval_status = 'approved' or public.is_current_user_admin());

drop policy if exists matches_write_admin on public.matches;
create policy matches_write_admin
  on public.matches
  for all
  to authenticated
  using (public.is_current_user_admin())
  with check (public.is_current_user_admin());

drop policy if exists match_veto_read on public.match_map_veto_actions;
create policy match_veto_read
  on public.match_map_veto_actions
  for select
  to anon, authenticated
  using (
    public.is_current_user_admin()
    or exists (
      select 1
      from public.matches m
      where m.id = match_map_veto_actions.match_id
        and m.approval_status = 'approved'
    )
  );

drop policy if exists match_veto_write_admin on public.match_map_veto_actions;
create policy match_veto_write_admin
  on public.match_map_veto_actions
  for all
  to authenticated
  using (public.is_current_user_admin())
  with check (public.is_current_user_admin());

drop policy if exists match_streams_read on public.match_streams;
create policy match_streams_read
  on public.match_streams
  for select
  to anon, authenticated
  using (
    public.is_current_user_admin()
    or exists (
      select 1
      from public.matches m
      where m.id = match_streams.match_id
        and m.approval_status = 'approved'
    )
  );

drop policy if exists match_streams_write_admin on public.match_streams;
create policy match_streams_write_admin
  on public.match_streams
  for all
  to authenticated
  using (public.is_current_user_admin())
  with check (public.is_current_user_admin());

drop policy if exists player_match_stats_read on public.player_match_stats;
create policy player_match_stats_read
  on public.player_match_stats
  for select
  to anon, authenticated
  using (
    public.is_current_user_admin()
    or status = 'approved'
    or profile_id = public.current_profile_id()
  );

drop policy if exists player_match_stats_write_admin on public.player_match_stats;
create policy player_match_stats_write_admin
  on public.player_match_stats
  for all
  to authenticated
  using (public.is_current_user_admin())
  with check (public.is_current_user_admin());

drop policy if exists stat_import_batches_admin_only on public.stat_import_batches;
create policy stat_import_batches_admin_only
  on public.stat_import_batches
  for all
  to authenticated
  using (public.is_current_user_admin())
  with check (public.is_current_user_admin());

drop policy if exists stat_import_errors_admin_only on public.stat_import_errors;
create policy stat_import_errors_admin_only
  on public.stat_import_errors
  for all
  to authenticated
  using (public.is_current_user_admin())
  with check (public.is_current_user_admin());

drop policy if exists leaderboard_entries_read on public.leaderboard_entries;
create policy leaderboard_entries_read
  on public.leaderboard_entries
  for select
  to anon, authenticated
  using (true);

drop policy if exists leaderboard_entries_write_admin on public.leaderboard_entries;
create policy leaderboard_entries_write_admin
  on public.leaderboard_entries
  for all
  to authenticated
  using (public.is_current_user_admin())
  with check (public.is_current_user_admin());

grant select on public.leaderboard_live to anon, authenticated;
