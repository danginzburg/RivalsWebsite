-- Enforce required team tags (2-4 letters) for new/updated rows.

alter table public.teams
  drop constraint if exists teams_tag_letters_len_check;

alter table public.teams
  add constraint teams_tag_letters_len_check
  check (tag is not null and tag ~ '^[A-Za-z]{2,4}$') not valid;
