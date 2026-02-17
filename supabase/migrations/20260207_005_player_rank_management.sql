-- Admin-managed player rank fields used for team eligibility.

alter table public.player_registration
  add column if not exists rank_label text,
  add column if not exists rank_value numeric(6,2),
  add column if not exists rank_updated_at timestamptz,
  add column if not exists rank_updated_by_profile_id uuid references public.profiles(id) on delete set null;

create index if not exists player_registration_rank_label_idx
  on public.player_registration(rank_label);
