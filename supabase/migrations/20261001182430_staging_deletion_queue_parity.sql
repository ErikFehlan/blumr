begin;
-- The original staging foundation used a two-column placeholder for the queue.
-- Preserve any requests and install the same lease/retention fields as production.
alter table public.account_deletions
 add column if not exists requested_at timestamptz not null default now(),
 add column if not exists lease_id uuid,
 add column if not exists lease_until timestamptz,
 add column if not exists attempts integer not null default 0,
 add column if not exists last_attempt_at timestamptz;
commit;
