-- Names, avatars and classes of the people in a chat. profiles is readable only by its owner (RLS), so the chat
-- showed everyone else as "Sinh viên" with the default avatar. Same public fields as the leaderboard / get_public_profile.
create or replace function public.chat_people(p_ids uuid[])
returns table(user_id uuid, display_name text, avatar_url text, class_name text)
language sql
stable
security definer
set search_path to 'public'
as $$
  select us.id,
    coalesce(nullif(trim(p.display_name), ''), nullif(trim(us.name), ''), 'Sinh viên'),
    p.avatar_url,
    coalesce(us.class_name, '')
  from public.users us
  left join public.profiles p on p.id = us.id
  where auth.uid() is not null
    and us.id = any (p_ids[1:200]);
$$;

revoke all on function public.chat_people(uuid[]) from public, anon;
grant execute on function public.chat_people(uuid[]) to authenticated;
