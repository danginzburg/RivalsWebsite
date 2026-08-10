-- Allow comment threads on season (event) pages.

alter table public.comments
  drop constraint if exists comments_entity_type_check;

alter table public.comments
  add constraint comments_entity_type_check
  check (entity_type in ('match', 'player', 'season'));
