-- Chat in the app (not the 3D map server): a general room for everyone signed in, private messages between any two
-- students, friends, blocking, and reports that the admins handle on /admin.
--
-- Messages are read straight from the table (RLS: the general room, and your own private conversations) and arrive
-- live through Supabase Realtime. Everything that writes goes through the functions below, which check the rules:
-- length, a small rate limit, chat bans, blocks.

create table if not exists public.chat_messages (
  id bigint generated always as identity primary key,
  sender_id uuid not null references auth.users (id) on delete cascade,
  recipient_id uuid references auth.users (id) on delete cascade, -- null: the general room
  body text not null check (char_length(body) between 1 and 1000),
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists chat_messages_general_idx on public.chat_messages (created_at desc) where recipient_id is null;
create index if not exists chat_messages_dm_idx on public.chat_messages
  (least(sender_id, recipient_id), greatest(sender_id, recipient_id), created_at desc) where recipient_id is not null;
create index if not exists chat_messages_to_idx on public.chat_messages (recipient_id, created_at desc) where recipient_id is not null;
create index if not exists chat_messages_from_idx on public.chat_messages (sender_id, created_at desc);
alter table public.chat_messages enable row level security;
drop policy if exists "Read the general room and own conversations" on public.chat_messages;
create policy "Read the general room and own conversations" on public.chat_messages for select to authenticated
  using (recipient_id is null or sender_id = auth.uid() or recipient_id = auth.uid());

-- when each student last opened a private conversation (for the unread counts)
create table if not exists public.chat_reads (
  user_id uuid not null references auth.users (id) on delete cascade,
  peer_id uuid not null references auth.users (id) on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key (user_id, peer_id)
);
alter table public.chat_reads enable row level security; -- through the functions only

create table if not exists public.friendships (
  requester uuid not null references auth.users (id) on delete cascade,
  addressee uuid not null references auth.users (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  primary key (requester, addressee),
  check (requester <> addressee)
);
create unique index if not exists friendships_pair_idx on public.friendships (least(requester, addressee), greatest(requester, addressee));
alter table public.friendships enable row level security;
drop policy if exists "Read own friendships" on public.friendships;
create policy "Read own friendships" on public.friendships for select to authenticated
  using (auth.uid() in (requester, addressee));

create table if not exists public.user_blocks (
  blocker uuid not null references auth.users (id) on delete cascade,
  blocked uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker, blocked),
  check (blocker <> blocked)
);
alter table public.user_blocks enable row level security;
drop policy if exists "Read own blocks" on public.user_blocks;
create policy "Read own blocks" on public.user_blocks for select to authenticated using (blocker = auth.uid());

create table if not exists public.user_reports (
  id bigint generated always as identity primary key,
  reporter uuid not null references auth.users (id) on delete cascade,
  reported uuid not null references auth.users (id) on delete cascade,
  reason text not null check (reason in ('spam', 'harass', 'offensive', 'impersonate', 'other')),
  details text check (char_length(details) <= 1000),
  message_id bigint references public.chat_messages (id) on delete set null,
  status text not null default 'open' check (status in ('open', 'resolved')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references auth.users (id) on delete set null,
  action text
);
create index if not exists user_reports_open_idx on public.user_reports (status, created_at desc);
alter table public.user_reports enable row level security; -- reporters write through report_user(), admins read through admin_reports()

create table if not exists public.chat_bans (
  user_id uuid primary key references auth.users (id) on delete cascade,
  until timestamptz, -- null: until lifted
  reason text,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null
);
alter table public.chat_bans enable row level security; -- through the functions only

-- live updates for the chat page
do $$ begin
  alter publication supabase_realtime add table public.chat_messages;
exception when duplicate_object then null; end $$;

-- ------------------------------------------------------------------------------------------------
-- Sending and deleting
-- ------------------------------------------------------------------------------------------------
create or replace function public.send_chat_message(p_body text, p_to uuid default null)
returns public.chat_messages
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  b text := btrim(coalesce(p_body, ''));
  ban public.chat_bans;
  msg public.chat_messages;
begin
  if me is null then raise exception 'not_signed_in'; end if;
  if b = '' then raise exception 'empty_message'; end if;
  if char_length(b) > 1000 then raise exception 'message_too_long'; end if;
  select * into ban from public.chat_bans where user_id = me and (until is null or until > now());
  if found then raise exception 'chat_banned:%', coalesce(to_char(ban.until at time zone 'Asia/Ho_Chi_Minh', 'HH24:MI DD/MM/YYYY'), ''); end if;
  if (select count(*) from public.chat_messages where sender_id = me and created_at > now() - interval '15 seconds') >= 6 then
    raise exception 'too_fast';
  end if;
  if p_to is not null then
    if p_to = me then raise exception 'self_message'; end if;
    if not exists (select 1 from auth.users where id = p_to) then raise exception 'no_such_user'; end if;
    if exists (select 1 from public.user_blocks where blocker = p_to and blocked = me) then raise exception 'blocked_by_them'; end if;
    if exists (select 1 from public.user_blocks where blocker = me and blocked = p_to) then raise exception 'you_blocked_them'; end if;
  end if;
  insert into public.chat_messages (sender_id, recipient_id, body) values (me, p_to, b) returning * into msg;
  if p_to is not null then
    insert into public.chat_reads (user_id, peer_id, last_read_at) values (me, p_to, now())
    on conflict (user_id, peer_id) do update set last_read_at = excluded.last_read_at;
  end if;
  return msg;
end;
$$;

-- your own message, or any message for an admin; the text is wiped, the row stays as "message deleted"
create or replace function public.delete_chat_message(p_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.chat_messages set deleted_at = now(), body = '·'
  where id = p_id and deleted_at is null and (sender_id = auth.uid() or public.is_admin());
  if not found then raise exception 'cannot_delete'; end if;
end;
$$;

-- ------------------------------------------------------------------------------------------------
-- Conversations list and unread counts
-- ------------------------------------------------------------------------------------------------
create or replace function public.chat_mark_read(p_peer uuid)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.chat_reads (user_id, peer_id, last_read_at)
  select auth.uid(), p_peer, now() where auth.uid() is not null and p_peer <> auth.uid()
  on conflict (user_id, peer_id) do update set last_read_at = excluded.last_read_at;
$$;

create or replace function public.chat_conversations()
returns table(peer_id uuid, display_name text, avatar_url text, last_body text, last_at timestamptz, last_mine boolean,
  last_deleted boolean, unread integer)
language sql
stable
security definer
set search_path = public
as $$
  with mine as (
    select case when m.sender_id = auth.uid() then m.recipient_id else m.sender_id end as peer, m.*
    from public.chat_messages m
    where m.recipient_id is not null and (m.sender_id = auth.uid() or m.recipient_id = auth.uid())
  ), last as (
    select distinct on (peer) * from mine order by peer, created_at desc
  )
  select l.peer,
    coalesce(nullif(trim(p.display_name), ''), 'Sinh viên'),
    p.avatar_url,
    l.body, l.created_at, l.sender_id = auth.uid(), l.deleted_at is not null,
    (select count(*)::int from mine u where u.peer = l.peer and u.sender_id = l.peer and u.deleted_at is null
       and u.created_at > coalesce((select r.last_read_at from public.chat_reads r where r.user_id = auth.uid() and r.peer_id = l.peer), '-infinity'))
  from last l
  left join public.profiles p on p.id = l.peer
  where not exists (select 1 from public.user_blocks b where b.blocker = auth.uid() and b.blocked = l.peer)
  order by l.created_at desc;
$$;

create or replace function public.chat_unread_total()
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::int from public.chat_messages m
  where m.recipient_id = auth.uid() and m.deleted_at is null
    and not exists (select 1 from public.user_blocks b where b.blocker = auth.uid() and b.blocked = m.sender_id)
    and m.created_at > coalesce((select r.last_read_at from public.chat_reads r where r.user_id = auth.uid() and r.peer_id = m.sender_id), '-infinity');
$$;

-- ------------------------------------------------------------------------------------------------
-- Friends and blocks
-- ------------------------------------------------------------------------------------------------
-- what the signed-in student is to someone: none | friends | sent | received, plus blocks either way
create or replace function public.relation_with(p_user uuid)
returns table(friend text, i_blocked boolean, blocked_me boolean)
language sql
stable
security definer
set search_path = public
as $$
  select
    coalesce((select case when f.status = 'accepted' then 'friends' when f.requester = auth.uid() then 'sent' else 'received' end
      from public.friendships f
      where least(f.requester, f.addressee) = least(auth.uid(), p_user) and greatest(f.requester, f.addressee) = greatest(auth.uid(), p_user)), 'none'),
    exists (select 1 from public.user_blocks where blocker = auth.uid() and blocked = p_user),
    exists (select 1 from public.user_blocks where blocker = p_user and blocked = auth.uid());
$$;

-- sends a request, or accepts theirs when they already asked
create or replace function public.friend_request(p_user uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  f public.friendships;
begin
  if me is null or p_user is null or p_user = me then raise exception 'bad_request'; end if;
  if not exists (select 1 from auth.users where id = p_user) then raise exception 'no_such_user'; end if;
  if exists (select 1 from public.user_blocks where (blocker = me and blocked = p_user) or (blocker = p_user and blocked = me)) then
    raise exception 'blocked';
  end if;
  select * into f from public.friendships
  where least(requester, addressee) = least(me, p_user) and greatest(requester, addressee) = greatest(me, p_user);
  if not found then
    if (select count(*) from public.friendships where requester = me and status = 'pending' and created_at > now() - interval '1 day') >= 50 then
      raise exception 'too_many_requests';
    end if;
    insert into public.friendships (requester, addressee) values (me, p_user);
    return 'sent';
  end if;
  if f.status = 'accepted' then return 'friends'; end if;
  if f.requester = me then return 'sent'; end if;
  update public.friendships set status = 'accepted', accepted_at = now() where requester = p_user and addressee = me;
  return 'friends';
end;
$$;

-- declines a request, cancels your own, or unfriends
create or replace function public.friend_remove(p_user uuid)
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.friendships
  where least(requester, addressee) = least(auth.uid(), p_user) and greatest(requester, addressee) = greatest(auth.uid(), p_user);
$$;

create or replace function public.my_friends()
returns table(user_id uuid, display_name text, avatar_url text, status text, since timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select o.id, coalesce(nullif(trim(p.display_name), ''), 'Sinh viên'), p.avatar_url,
    case when f.status = 'accepted' then 'friends' when f.requester = auth.uid() then 'sent' else 'received' end,
    coalesce(f.accepted_at, f.created_at)
  from public.friendships f
  cross join lateral (select case when f.requester = auth.uid() then f.addressee else f.requester end as id) o
  left join public.profiles p on p.id = o.id
  where auth.uid() in (f.requester, f.addressee)
  order by (f.status = 'pending' and f.addressee = auth.uid()) desc, coalesce(f.accepted_at, f.created_at) desc;
$$;

create or replace function public.block_user(p_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or p_user is null or p_user = auth.uid() then raise exception 'bad_request'; end if;
  insert into public.user_blocks (blocker, blocked) values (auth.uid(), p_user) on conflict do nothing;
  delete from public.friendships
  where least(requester, addressee) = least(auth.uid(), p_user) and greatest(requester, addressee) = greatest(auth.uid(), p_user);
end;
$$;

create or replace function public.unblock_user(p_user uuid)
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.user_blocks where blocker = auth.uid() and blocked = p_user;
$$;

-- ------------------------------------------------------------------------------------------------
-- Reports and chat bans (admins)
-- ------------------------------------------------------------------------------------------------
create or replace function public.report_user(p_user uuid, p_reason text, p_details text default null, p_message bigint default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
begin
  if me is null or p_user is null or p_user = me then raise exception 'bad_request'; end if;
  if not exists (select 1 from auth.users where id = p_user) then raise exception 'no_such_user'; end if;
  if (select count(*) from public.user_reports where reporter = me and created_at > now() - interval '1 day') >= 10 then
    raise exception 'too_many_reports';
  end if;
  if p_message is not null and not exists (
    select 1 from public.chat_messages m where m.id = p_message and m.sender_id = p_user
      and (m.recipient_id is null or m.recipient_id = me)) then
    p_message := null;
  end if;
  insert into public.user_reports (reporter, reported, reason, details, message_id)
  values (me, p_user, p_reason, nullif(left(btrim(coalesce(p_details, '')), 1000), ''), p_message);
end;
$$;

create or replace function public.my_chat_ban()
returns timestamptz
language sql
stable
security definer
set search_path = public
as $$
  -- null: not banned; 'infinity': until lifted; otherwise the end of the ban
  select coalesce(until, 'infinity') from public.chat_bans where user_id = auth.uid() and (until is null or until > now());
$$;

create or replace function public.admin_reports(p_status text default 'open')
returns table(id bigint, created_at timestamptz, reason text, details text, status text, action text,
  reporter uuid, reporter_name text, reported uuid, reported_name text, reported_avatar text,
  message_body text, message_at timestamptz, reports_on_user integer, banned_until timestamptz)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'not_admin'; end if;
  return query
  select r.id, r.created_at, r.reason, r.details, r.status, r.action,
    r.reporter, coalesce(nullif(trim(pr.display_name), ''), 'Sinh viên'),
    r.reported, coalesce(nullif(trim(pd.display_name), ''), 'Sinh viên'), pd.avatar_url,
    case when m.deleted_at is null then m.body else '(đã xóa)' end, m.created_at,
    (select count(*)::int from public.user_reports x where x.reported = r.reported),
    (select coalesce(b.until, 'infinity') from public.chat_bans b where b.user_id = r.reported and (b.until is null or b.until > now()))
  from public.user_reports r
  left join public.profiles pr on pr.id = r.reporter
  left join public.profiles pd on pd.id = r.reported
  left join public.chat_messages m on m.id = r.message_id
  where p_status = 'all' or r.status = p_status
  order by r.created_at desc
  limit 200;
end;
$$;

-- closes a report; optionally bans the reported student from chatting (hours; 0 = until lifted) and deletes the message
create or replace function public.admin_resolve_report(p_id bigint, p_ban_hours integer default null, p_delete_message boolean default false)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.user_reports;
  what text := 'Bỏ qua';
begin
  if not public.is_admin() then raise exception 'not_admin'; end if;
  select * into r from public.user_reports where id = p_id;
  if not found then raise exception 'no_such_report'; end if;
  if p_delete_message and r.message_id is not null then
    update public.chat_messages set deleted_at = now(), body = '·' where id = r.message_id and deleted_at is null;
    what := 'Xóa tin nhắn';
  end if;
  if p_ban_hours is not null then
    insert into public.chat_bans (user_id, until, reason, created_by)
    values (r.reported, case when p_ban_hours > 0 then now() + make_interval(hours => p_ban_hours) end, r.reason, auth.uid())
    on conflict (user_id) do update set until = excluded.until, reason = excluded.reason, created_by = excluded.created_by, created_at = now();
    what := case when what = 'Bỏ qua' then '' else what || ' + ' end
      || case when p_ban_hours > 0 then 'Khóa chat ' || p_ban_hours || ' giờ' else 'Khóa chat vô thời hạn' end;
  end if;
  update public.user_reports set status = 'resolved', resolved_at = now(), resolved_by = auth.uid(), action = what where id = p_id;
end;
$$;

create or replace function public.admin_unban_chat(p_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'not_admin'; end if;
  delete from public.chat_bans where user_id = p_user;
end;
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'send_chat_message(text, uuid)', 'delete_chat_message(bigint)', 'chat_mark_read(uuid)', 'chat_conversations()',
    'chat_unread_total()', 'relation_with(uuid)', 'friend_request(uuid)', 'friend_remove(uuid)', 'my_friends()',
    'block_user(uuid)', 'unblock_user(uuid)', 'report_user(uuid, text, text, bigint)', 'my_chat_ban()',
    'admin_reports(text)', 'admin_resolve_report(bigint, integer, boolean)', 'admin_unban_chat(uuid)'
  ] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
