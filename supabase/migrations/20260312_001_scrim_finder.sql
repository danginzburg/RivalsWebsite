create table if not exists public.scrim_slots (
  id uuid primary key default gen_random_uuid(),
  slot_type text not null default 'open' check (slot_type in ('open', 'targeted')),
  status text not null default 'open' check (status in ('open', 'pending_selection', 'filled', 'cancelled', 'expired')),
  team_name text not null,
  rep_name text not null,
  discord_handle text not null,
  target_team_name text,
  scheduled_at timestamptz not null,
  notes text,
  accepted_claim_id uuid,
  manage_token_hash text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (char_length(trim(team_name)) between 2 and 80),
  check (char_length(trim(rep_name)) between 2 and 80),
  check (char_length(trim(discord_handle)) between 2 and 64),
  check (slot_type = 'open' or char_length(trim(coalesce(target_team_name, ''))) >= 2)
);

create table if not exists public.scrim_slot_claims (
  id uuid primary key default gen_random_uuid(),
  slot_id uuid not null references public.scrim_slots(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'rejected', 'withdrawn')),
  team_name text not null,
  rep_name text not null,
  discord_handle text not null,
  message text,
  manage_token_hash text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (char_length(trim(team_name)) between 2 and 80),
  check (char_length(trim(rep_name)) between 2 and 80),
  check (char_length(trim(discord_handle)) between 2 and 64)
);

do $$
begin
  if not exists (
    select 1
    from information_schema.table_constraints
    where constraint_schema = 'public'
      and table_name = 'scrim_slots'
      and constraint_name = 'scrim_slots_accepted_claim_id_fkey'
  ) then
    alter table public.scrim_slots
      add constraint scrim_slots_accepted_claim_id_fkey
      foreign key (accepted_claim_id)
      references public.scrim_slot_claims(id)
      on delete set null;
  end if;
end
$$;

create index if not exists scrim_slots_status_scheduled_idx
  on public.scrim_slots(status, scheduled_at);

create index if not exists scrim_slots_scheduled_idx
  on public.scrim_slots(scheduled_at);

create index if not exists scrim_slots_target_team_idx
  on public.scrim_slots(lower(target_team_name));

create index if not exists scrim_slot_claims_slot_idx
  on public.scrim_slot_claims(slot_id, status, created_at);

create unique index if not exists scrim_slot_claims_unique_accepted
  on public.scrim_slot_claims(slot_id)
  where status = 'accepted';

create unique index if not exists scrim_slot_claims_unique_pending_team
  on public.scrim_slot_claims(slot_id, lower(team_name))
  where status = 'pending';

drop trigger if exists trg_scrim_slots_updated_at on public.scrim_slots;
create trigger trg_scrim_slots_updated_at
before update on public.scrim_slots
for each row execute function public.set_updated_at();

drop trigger if exists trg_scrim_slot_claims_updated_at on public.scrim_slot_claims;
create trigger trg_scrim_slot_claims_updated_at
before update on public.scrim_slot_claims
for each row execute function public.set_updated_at();
