-- Admin-set display name for a player who has never logged in.
--
-- Display names live on profiles, but a profile only exists once someone signs
-- in. Players seen in match imports who never have are just a PUUID in
-- `riot_identities`, so their admin-chosen name is kept here. It is shown in
-- place of the imported Riot name on stats, and adopted as the profile's custom
-- display name when the player later links this PUUID to an account.

alter table public.riot_identities
  add column if not exists display_name text;
