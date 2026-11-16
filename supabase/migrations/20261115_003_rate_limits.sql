-- Rate limits shared across server instances.
--
-- The site runs as Vercel serverless functions, so an in-memory limiter only
-- counts the requests that happened to land on one instance. Per-user action
-- limits (comments, reports, Riot lookups, imports) are counted here instead.
--
-- One row per key with a fixed window: the upsert takes a row lock, so two
-- concurrent calls for the same key cannot both slip under the limit.

create table if not exists public.rate_limit_buckets (
  key text primary key,
  window_start timestamptz not null,
  hits integer not null
);

alter table public.rate_limit_buckets enable row level security;

-- Supabase no longer auto-grants new tables (since 2026-10-30). Server only.
grant select, insert, update, delete on public.rate_limit_buckets to service_role;

/*
 * Count one hit against `p_key`. Returns 0 when the hit is allowed, otherwise
 * the milliseconds until the window resets.
 */
create or replace function public.consume_rate_limit(
  p_key text,
  p_limit integer,
  p_window_ms integer
) returns integer
language plpgsql
set search_path = public
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_window interval := make_interval(secs => p_window_ms / 1000.0);
  v_start timestamptz;
  v_hits integer;
begin
  insert into public.rate_limit_buckets as b (key, window_start, hits)
  values (p_key, v_now, 1)
  on conflict (key) do update
    set window_start = case when b.window_start + v_window <= v_now then v_now else b.window_start end,
        hits = case when b.window_start + v_window <= v_now then 1 else b.hits + 1 end
  returning b.window_start, b.hits into v_start, v_hits;

  -- Now and then, drop buckets nobody has touched for a day.
  if random() < 0.01 then
    delete from public.rate_limit_buckets where window_start < v_now - interval '1 day';
  end if;

  if v_hits > p_limit then
    return greatest(1, ceil(extract(epoch from (v_start + v_window - v_now)) * 1000))::integer;
  end if;
  return 0;
end;
$$;

revoke execute on function public.consume_rate_limit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.consume_rate_limit(text, integer, integer) to service_role;
