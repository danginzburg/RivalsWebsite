-- Mark whether a season is a "Rivals" event or an external tournament that
-- reuses the same infrastructure (matches, stats, standings) but hosts its
-- rulebook / signups / FAQ elsewhere. The default keeps every existing row a
-- rivals event, so behaviour is unchanged until an event is explicitly set to
-- 'external'. The per-event presentation profile (which sections show, outbound
-- links) lives in the existing seasons.metadata jsonb, not a column.

alter table public.seasons
  add column if not exists kind text not null default 'rivals';

alter table public.seasons
  drop constraint if exists seasons_kind_check;

alter table public.seasons
  add constraint seasons_kind_check check (kind in ('rivals', 'external'));
