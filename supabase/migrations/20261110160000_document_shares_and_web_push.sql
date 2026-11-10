-- Web version features (user approved 2026-11-10):
--   1. Share a document folder/file through a public link (read-only), served by Edge Function `shared-documents`.
--   2. Web Push reminders for deadlines (24h/6h/1h/15m before, at the deadline, and daily at 7h/13h/19h VN),
--      sent by Edge Function `push-reminders`, triggered by pg_cron every 5 minutes.
-- Secrets (VAPID keys, cron secret) live in Supabase Vault and are NOT part of this file:
--   vault secrets: push_vapid_public, push_vapid_private, push_vapid_subject, push_cron_secret
-- Existing tables and policies are not changed.

create extension if not exists pg_net with schema extensions;

-- ---------------------------------------------------------------------------
-- 1. Document shares
-- ---------------------------------------------------------------------------
create table public.document_shares (
  id uuid primary key default gen_random_uuid(),
  token text not null unique default encode(extensions.gen_random_bytes(16), 'hex'),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  document_id uuid not null references public.documents(id) on delete cascade,
  allow_download boolean not null default true,
  expires_at timestamptz,
  revoked_at timestamptz,
  view_count integer not null default 0,
  created_at timestamptz not null default now()
);
create index document_shares_owner_idx on public.document_shares (owner_id);
create index document_shares_document_idx on public.document_shares (document_id);

alter table public.document_shares enable row level security;

create policy "Owners read own shares" on public.document_shares
  for select to authenticated using (owner_id = auth.uid());
create policy "Owners create shares of own documents" on public.document_shares
  for insert to authenticated with check (
    owner_id = auth.uid()
    and exists (select 1 from public.documents d where d.id = document_id and d.user_id = auth.uid())
  );
create policy "Owners update own shares" on public.document_shares
  for update to authenticated using (owner_id = auth.uid()) with check (
    owner_id = auth.uid()
    and exists (select 1 from public.documents d where d.id = document_id and d.user_id = auth.uid())
  );
create policy "Owners delete own shares" on public.document_shares
  for delete to authenticated using (owner_id = auth.uid());

revoke all on public.document_shares from anon;
grant select, insert, update, delete on public.document_shares to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Web Push
-- ---------------------------------------------------------------------------
create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  last_success_at timestamptz
);
create index push_subscriptions_user_idx on public.push_subscriptions (user_id);
alter table public.push_subscriptions enable row level security;
create policy "Users read own push subscriptions" on public.push_subscriptions
  for select to authenticated using (user_id = auth.uid());
create policy "Users delete own push subscriptions" on public.push_subscriptions
  for delete to authenticated using (user_id = auth.uid());
revoke all on public.push_subscriptions from anon;
grant select, delete on public.push_subscriptions to authenticated;

-- Dedup log for sent reminders (service role only: RLS on, no policies).
create table public.push_reminder_log (
  ref text primary key,
  user_id uuid references auth.users(id) on delete cascade,
  sent_at timestamptz not null default now()
);
alter table public.push_reminder_log enable row level security;
revoke all on public.push_reminder_log from anon, authenticated;

-- Register this browser for the caller. An endpoint belongs to one user (shared devices move it).
create or replace function public.register_push_subscription(
  p_endpoint text, p_p256dh text, p_auth text, p_user_agent text default null
) returns void
language plpgsql security definer set search_path to 'public' as $$
begin
  if auth.uid() is null then raise exception 'Chưa đăng nhập.'; end if;
  if coalesce(p_endpoint, '') !~ '^https://' or coalesce(p_p256dh, '') = '' or coalesce(p_auth, '') = '' then
    raise exception 'Subscription không hợp lệ.';
  end if;
  delete from public.push_subscriptions where endpoint = p_endpoint and user_id <> auth.uid();
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
  values (auth.uid(), p_endpoint, p_p256dh, p_auth, left(p_user_agent, 300))
  on conflict (endpoint) do update set p256dh = excluded.p256dh, auth = excluded.auth, user_agent = excluded.user_agent;
end $$;
revoke execute on function public.register_push_subscription(text, text, text, text) from public, anon;
grant execute on function public.register_push_subscription(text, text, text, text) to authenticated;

-- Push configuration from Vault, for the Edge Function (service role) only.
create or replace function public.get_push_config()
returns table (vapid_public text, vapid_private text, vapid_subject text, cron_secret text)
language sql security definer set search_path to 'public' as $$
  select
    (select decrypted_secret from vault.decrypted_secrets where name = 'push_vapid_public'),
    (select decrypted_secret from vault.decrypted_secrets where name = 'push_vapid_private'),
    (select decrypted_secret from vault.decrypted_secrets where name = 'push_vapid_subject'),
    (select decrypted_secret from vault.decrypted_secrets where name = 'push_cron_secret');
$$;
revoke execute on function public.get_push_config() from public, anon, authenticated;
grant execute on function public.get_push_config() to service_role;

-- Every 5 minutes: ask the Edge Function to send due reminders.
select cron.schedule(
  'push-deadline-reminders',
  '*/5 * * * *',
  $cron$
  select net.http_post(
    url := 'https://gmwurbvhhzgdikogxiqb.supabase.co/functions/v1/push-reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'push_cron_secret')
    ),
    body := '{"action":"cron"}'::jsonb,
    timeout_milliseconds := 25000
  );
  $cron$
);
