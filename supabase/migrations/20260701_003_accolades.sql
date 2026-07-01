create table if not exists public.accolades (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  logo_path text,
  icon_key text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.accolade_assignments (
  id uuid primary key default gen_random_uuid(),
  accolade_id uuid not null references public.accolades(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (accolade_id, profile_id)
);

create index if not exists accolade_assignments_profile_idx on public.accolade_assignments(profile_id);
create index if not exists accolade_assignments_accolade_idx on public.accolade_assignments(accolade_id);

insert into public.accolades (name, icon_key) values
  ('1st Place', 'gold_medal'),
  ('2nd Place', 'silver_medal'),
  ('3rd Place', 'bronze_medal')
on conflict do nothing;
