-- Allow 2-4 character alphanumeric team tags such as FN4F.

alter table public.teams
  drop constraint if exists teams_tag_letters_len_check;

alter table public.teams
  add constraint teams_tag_letters_len_check
  check (tag is not null and tag ~ '^[A-Za-z0-9]{2,4}$') not valid;
