alter table public.pickem_submissions
  drop constraint if exists pickem_submissions_kind_check;

alter table public.pickem_submissions
  add constraint pickem_submissions_kind_check
  check (kind in ('final_buckets', 'playoff_bracket'));
