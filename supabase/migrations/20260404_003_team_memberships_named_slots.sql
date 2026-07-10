-- Allow team memberships to exist before a user account is linked.

alter table public.team_memberships
  alter column profile_id drop not null,
  add column if not exists player_name text;

update public.team_memberships tm
set player_name = coalesce(tm.player_name, p.riot_id_base, p.display_name, p.email)
from public.profiles p
where tm.profile_id = p.id
  and tm.player_name is null;

alter table public.team_memberships
  add constraint team_memberships_profile_or_name_required
  check (profile_id is not null or player_name is not null);

create unique index if not exists team_memberships_active_player_name_unique
  on public.team_memberships (lower(player_name))
  where is_active = true and left_at is null and player_name is not null;
