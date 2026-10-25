-- Rally keeps everything in one small key-value table. The bot uses the service key, which bypasses row level
-- security, and no policy is defined, so the anonymous key can read and write nothing.
create table if not exists rally_kv (
  ns text not null,
  key text not null,
  value jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (ns, key)
);

alter table rally_kv enable row level security;

create index if not exists rally_kv_ns_idx on rally_kv (ns);

-- Run the tick every 5 minutes (needs the pg_cron and pg_net extensions; replace the URL and secret):
-- select cron.schedule('rally-tick', '*/5 * * * *', $$
--   select net.http_post(
--     url := 'https://YOUR-APP.vercel.app/api/tick',
--     headers := jsonb_build_object('x-cron-secret', 'YOUR-CRON-SECRET', 'content-type', 'application/json'),
--     body := '{}'::jsonb
--   );
-- $$);
