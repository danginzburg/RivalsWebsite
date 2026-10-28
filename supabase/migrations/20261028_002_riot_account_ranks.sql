-- A Riot account's competitive rank, kept on the account like its name.
--
-- Match imports refresh it from the tier Riot reports for each player in the
-- match, so it updates the same way a rename does. Accounts that have not
-- appeared in an imported match yet are filled by the admin rank refresh,
-- which asks HenrikDev for their current rank.
--
-- `rank` uses the league's names ("Gold 2", "Immortal 3", "Radiant"), the same
-- scale signups and stat imports use. Null means unrated or not checked yet.

alter table public.riot_accounts
  add column if not exists rank text,
  add column if not exists rank_updated_at timestamptz;
