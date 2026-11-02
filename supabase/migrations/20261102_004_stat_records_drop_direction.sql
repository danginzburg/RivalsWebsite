-- Records track highs only. An early version of 20261102_001 created a
-- not-null `direction` column ('high' | 'low') that the rebuild no longer
-- writes, so every insert failed where that version was applied. Drop it.

alter table public.stat_records drop column if exists direction;
