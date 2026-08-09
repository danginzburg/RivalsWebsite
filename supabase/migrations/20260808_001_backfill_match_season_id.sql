-- Backfill season_id on existing matches that were created before
-- match creation started setting season_id automatically.
-- Idempotent: only touches rows where season_id IS NULL.

update public.matches m
set season_id = coalesce(

  -- 1) Season whose date range contains the match's scheduled_at
  (
    select s.id
    from public.seasons s
    where m.scheduled_at is not null
      and s.starts_on is not null
      and m.scheduled_at::date >= s.starts_on
      and (s.ends_on is null or m.scheduled_at::date <= s.ends_on)
    order by s.starts_on desc
    limit 1
  ),

  -- 2) Season whose date range contains the match's created_at
  (
    select s.id
    from public.seasons s
    where s.starts_on is not null
      and m.created_at::date >= s.starts_on
      and (s.ends_on is null or m.created_at::date <= s.ends_on)
    order by s.starts_on desc
    limit 1
  ),

  -- 3) Earliest season as a last-resort fallback
  (
    select s.id
    from public.seasons s
    order by s.starts_on asc nulls last, s.created_at asc
    limit 1
  )

)
where m.season_id is null;
