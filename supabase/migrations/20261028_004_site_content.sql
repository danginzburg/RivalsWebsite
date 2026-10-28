-- Admin-editable site documents (the rulebook, the FAQ, and any later page).
--
-- Each row is one whole document stored as JSON, keyed by a short name the
-- code knows about (see src/lib/content/documents.ts, which also validates the
-- shape and holds the default content shown until a row exists). One document
-- per row rather than a row per section: admins edit, reorder and save the
-- whole thing at once, and a save is a single atomic write.

create table if not exists public.site_content (
  key text primary key check (key ~ '^[a-z0-9-]+$'),
  document jsonb not null,
  updated_by_profile_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists site_content_set_updated_at on public.site_content;
create trigger site_content_set_updated_at
  before update on public.site_content
  for each row execute function public.set_updated_at();

alter table public.site_content enable row level security;

-- Read and written through the service role only (public pages load it server-side).
drop policy if exists "site_content_select" on public.site_content;
create policy "site_content_select" on public.site_content
  for select using (false);
