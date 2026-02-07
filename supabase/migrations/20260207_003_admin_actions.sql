-- Admin moderation and operational audit trail.

create table if not exists public.admin_actions (
  id bigserial primary key,
  admin_profile_id uuid references public.profiles(id) on delete set null,
  action_type text not null,
  target_table text,
  target_id text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists admin_actions_admin_idx on public.admin_actions(admin_profile_id);
create index if not exists admin_actions_action_type_idx on public.admin_actions(action_type);
create index if not exists admin_actions_target_idx on public.admin_actions(target_table, target_id);
create index if not exists admin_actions_created_at_idx on public.admin_actions(created_at desc);

alter table public.admin_actions enable row level security;

drop policy if exists admin_actions_read_admin on public.admin_actions;
create policy admin_actions_read_admin
  on public.admin_actions
  for select
  to authenticated
  using (public.is_current_user_admin());

drop policy if exists admin_actions_write_admin on public.admin_actions;
create policy admin_actions_write_admin
  on public.admin_actions
  for insert
  to authenticated
  with check (public.is_current_user_admin());
