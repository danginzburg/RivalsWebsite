-- Drop the starter flag. It only ever fed a guessed "expected lineup" on match
-- pages before real stats were imported; that guess has been removed, so the
-- column has no remaining reader.

alter table public.team_memberships
  drop column if exists is_starter;
