-- Admin dashboard (/admin on the web app): usage statistics for the site owner only.
--
-- * user_activity: one row per (account, day) the account opened the app. Written by track_activity(), which the
--   web app calls once a day per signed-in browser. Before this table existed, activity is estimated from login
--   sessions / token refreshes and from check-ins, documents and deadlines (see admin_stats).
-- * app_admins: who may read the statistics (rows added by hand, never from the app).
-- * hit_page_view also counts 'app' (one visit per browser tab session on any page of the web app).
-- * admin_stats(p_days): everything the dashboard shows, as one JSON; raises for anyone not in app_admins.
-- * is_admin(): whether the signed-in account may open the dashboard (shows the link on the profile page).

create table if not exists public.user_activity (
  user_id uuid not null references auth.users (id) on delete cascade,
  day date not null,
  primary key (user_id, day)
);
alter table public.user_activity enable row level security; -- no policies: only the functions below touch it

create table if not exists public.app_admins (
  user_id uuid primary key references auth.users (id) on delete cascade
);
alter table public.app_admins enable row level security; -- no policies: read through is_admin() / admin_stats()

create or replace function public.track_activity()
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.user_activity (user_id, day)
  select auth.uid(), (now() at time zone 'Asia/Ho_Chi_Minh')::date
  where auth.uid() is not null
  on conflict do nothing;
$$;
revoke all on function public.track_activity() from public, anon;
grant execute on function public.track_activity() to authenticated;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.app_admins where user_id = auth.uid());
$$;
revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

create or replace function public.hit_page_view(p_page text, p_count boolean default true)
returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_day date := (now() at time zone 'Asia/Ho_Chi_Minh')::date;
  v_total bigint;
  v_today bigint;
  v_users bigint;
begin
  if p_page is null or p_page not in ('map', 'app') then
    raise exception 'unknown page';
  end if;
  if p_count then
    insert into public.page_views (page, day, views) values (p_page, v_day, 1)
    on conflict (page, day) do update set views = public.page_views.views + 1;
  end if;
  select coalesce(sum(views), 0), coalesce(sum(views) filter (where day = v_day), 0)
    into v_total, v_today
    from public.page_views where page = p_page;
  select count(*) into v_users from public.profiles;
  return json_build_object('total', v_total, 'today', v_today, 'users', v_users);
end;
$function$;

create or replace function public.admin_stats(p_days int default 60)
returns json
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
  v_today date := (now() at time zone 'Asia/Ho_Chi_Minh')::date;
  v_days int := greatest(7, least(coalesce(p_days, 60), 365));
  v_out json;
begin
  if auth.uid() is null or not exists (select 1 from public.app_admins where user_id = auth.uid()) then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  with acc as ( -- real accounts (email confirmed)
    select u.id, (u.created_at at time zone 'Asia/Ho_Chi_Minh')::date as d0
    from auth.users u where u.email_confirmed_at is not null
  ),
  raw as ( -- every trace of someone using the app: (account, moment) or (account, day)
    select a.user_id, null::timestamptz as at, a.day from public.user_activity a
    union all select r.user_id::uuid, r.created_at, null from auth.refresh_tokens r where r.user_id ~ '^[0-9a-f-]{36}$'
    union all select s.user_id, s.created_at, null from auth.sessions s
    union all select s.user_id, s.refreshed_at at time zone 'UTC', null from auth.sessions s where s.refreshed_at is not null
    union all select c.user_id, c.checked_in_at, null from public.check_ins c
    union all select d.user_id, d.created_at, null from public.documents d
    union all select t.user_id, t.created_at, null from public.deadline_tasks t
  ),
  act as ( -- (account, VN day) it was active; the sign-up day counts
    select distinct r.user_id, coalesce(r.day, (r.at at time zone 'Asia/Ho_Chi_Minh')::date) as day
    from raw r join acc on acc.id = r.user_id
    union
    select acc.id, acc.d0 from acc
  ),
  per as ( -- per account
    select acc.id, acc.d0, count(*) as n_days, max(act.day) as last_day,
      bool_or(act.day > acc.d0) as returned,
      bool_or(act.day = acc.d0 + 1) as d1,
      bool_or(act.day between acc.d0 + 7 and acc.d0 + 13) as d7,
      bool_or(act.day >= acc.d0 + 30) as d30
    from acc join act on act.user_id = acc.id
    group by acc.id, acc.d0
  ),
  days as (
    select generate_series(v_today - v_days + 1, v_today, interval '1 day')::date as day
  )
  select json_build_object(
    'today', v_today,
    'days', v_days,
    'totals', json_build_object(
      'accounts', (select count(*) from acc),
      'unconfirmed', (select count(*) from auth.users where email_confirmed_at is null),
      'signups_today', (select count(*) from acc where d0 = v_today),
      'signups_7d', (select count(*) from acc where d0 > v_today - 7),
      'dau', (select count(distinct user_id) from act where day = v_today),
      'wau', (select count(distinct user_id) from act where day > v_today - 7),
      'mau', (select count(distinct user_id) from act where day > v_today - 30),
      'dau_avg7', (select round(count(*)::numeric / 7, 1) from act where day > v_today - 7),
      'map_views', (select coalesce(sum(views), 0) from public.page_views where page = 'map'),
      'app_views', (select coalesce(sum(views), 0) from public.page_views where page = 'app'),
      'tracked_since', (select min(day) from public.user_activity)
    ),
    'retention', json_build_object(
      'returned', (select json_build_object('n', count(*), 'yes', count(*) filter (where returned)) from per where d0 <= v_today - 1),
      'd1', (select json_build_object('n', count(*), 'yes', count(*) filter (where d1)) from per where d0 <= v_today - 1),
      'd7', (select json_build_object('n', count(*), 'yes', count(*) filter (where d7)) from per where d0 <= v_today - 7),
      'd30', (select json_build_object('n', count(*), 'yes', count(*) filter (where d30)) from per where d0 <= v_today - 30)
    ),
    'daily', (select json_agg(json_build_object(
        'day', d.day,
        'signups', (select count(*) from acc where acc.d0 = d.day),
        'active', (select count(distinct act.user_id) from act where act.day = d.day),
        'returning', (select count(distinct act.user_id) from act join acc on acc.id = act.user_id where act.day = d.day and acc.d0 < d.day),
        'map', (select coalesce(sum(v.views), 0) from public.page_views v where v.page = 'map' and v.day = d.day),
        'app', (select coalesce(sum(v.views), 0) from public.page_views v where v.page = 'app' and v.day = d.day)
      ) order by d.day) from days d),
    'cohorts', (select json_agg(c order by c.week) from (
        select date_trunc('week', per.d0)::date as week, count(*) as size,
          count(*) filter (where per.returned) as returned,
          count(*) filter (where per.last_day > v_today - 7) as active_now
        from per group by 1
      ) c),
    'depth', (select json_agg(b order by b.k) from (
        select case when n_days = 1 then 1 when n_days = 2 then 2 when n_days <= 5 then 3 when n_days <= 10 then 4 else 5 end as k, count(*) as n
        from per group by 1
      ) b),
    'hours', (select json_agg(h order by h.hour) from (
        select extract(hour from raw.at at time zone 'Asia/Ho_Chi_Minh')::int as hour, count(*) as n
        from raw join acc on acc.id = raw.user_id
        where raw.at is not null and raw.at > now() - interval '30 days'
        group by 1
      ) h),
    'features', json_build_object(
      'timetable', (select count(distinct user_id) from public.class_sessions),
      'checkin_users', (select count(distinct user_id) from public.check_ins),
      'checkins', (select count(*) from public.check_ins),
      'doc_users', (select count(distinct user_id) from public.documents where item_type = 'file'),
      'docs', (select count(*) from public.documents where item_type = 'file'),
      'deadline_users', (select count(distinct user_id) from public.deadline_tasks),
      'push_users', (select count(distinct user_id) from public.push_subscriptions),
      'shares', (select count(*) from public.document_shares),
      'share_views', (select coalesce(sum(view_count), 0) from public.document_shares)
    )
  ) into v_out;
  return v_out;
end;
$$;
revoke all on function public.admin_stats(int) from public, anon;
grant execute on function public.admin_stats(int) to authenticated;
