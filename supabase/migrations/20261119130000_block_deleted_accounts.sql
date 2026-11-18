-- A deleted account came back: after it was deleted on the phone, a computer still signed in to it kept a valid
-- access token for up to an hour. Reloading there ran ensureCurrentUserData(), which found no public.users row and
-- created a new one (and a profile), so the account showed "complete your profile" and the account count went
-- from 443 to 444. public.users has no foreign key to auth.users, so nothing stopped it.
--
-- 1. A row in public.users (and so a profile, which references it) can only be created for a user that exists in
--    auth.users. The web app signs out when it sees this error ("account_deleted").
-- 2. Remove the rows left by deleted accounts (no auth.users row), with their timetable.

create or replace function public.users_require_auth_user()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
begin
  if not exists (select 1 from auth.users a where a.id = new.id) then
    raise exception 'account_deleted' using errcode = 'P0001', hint = 'This account no longer exists.';
  end if;
  return new;
end;
$$;

drop trigger if exists users_require_auth_user on public.users;
create trigger users_require_auth_user
  before insert on public.users
  for each row execute function public.users_require_auth_user();

revoke all on function public.users_require_auth_user() from public, anon, authenticated;

do $$
declare
  ghosts uuid[];
begin
  select array_agg(u.id) into ghosts
  from public.users u
  where not exists (select 1 from auth.users a where a.id = u.id);
  if ghosts is null then
    return;
  end if;
  delete from public.check_in_verifications where user_id = any (ghosts);
  delete from public.check_ins where user_id = any (ghosts);
  update public.class_session_occurrences set makeup_occurrence_id = null
    where makeup_occurrence_id in (select o.id from public.class_session_occurrences o
      join public.class_sessions cs on cs.id = o.class_session_id where cs.user_id = any (ghosts));
  delete from public.class_session_occurrences
    where class_session_id in (select id from public.class_sessions where user_id = any (ghosts));
  delete from public.class_sessions where user_id = any (ghosts);
  delete from public.subjects where user_id = any (ghosts);
  delete from public.users where id = any (ghosts); -- profiles go with it (on delete cascade)
end;
$$;
