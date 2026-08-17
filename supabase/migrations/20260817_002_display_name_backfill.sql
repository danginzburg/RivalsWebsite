-- Make profiles.display_name the player's chosen site name.
--
-- display_name used to be overwritten with the Discord username on every login,
-- so the site leaned on riot_id_base as the real name via `riot_id_base ??
-- display_name` fallbacks everywhere. We are flipping that: display_name becomes
-- the authoritative, player-chosen name (defaulting to the Riot name), and the
-- login handler no longer clobbers it.
--
-- Backfilling display_name to the Riot name where one exists keeps every
-- signed-up player's displayed name exactly what it is today, so flipping the
-- read precedence to display_name-first is a no-op for existing data.

update public.profiles
set display_name = coalesce(riot_id_base, display_name)
where riot_id_base is not null;

-- Tracks whether the player deliberately chose their display name. While false,
-- the signup flow keeps display_name in step with the primary Riot name; once
-- the player edits it themselves the flag flips and the site stops touching it.
alter table public.profiles
  add column if not exists display_name_is_custom boolean not null default false;
