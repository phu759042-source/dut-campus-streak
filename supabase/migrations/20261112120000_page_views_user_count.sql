-- The 3D map's stats chip also shows how many students have an account.
-- hit_page_view() now returns `users` too: the number of profiles (one per confirmed account).
-- It is only a count; no profile data is exposed.
create or replace function public.hit_page_view(p_page text, p_count boolean default true)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_day date := (now() at time zone 'Asia/Ho_Chi_Minh')::date;
  v_total bigint;
  v_today bigint;
  v_users bigint;
begin
  if p_page is null or p_page not in ('map') then
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
$$;

revoke all on function public.hit_page_view(text, boolean) from public;
grant execute on function public.hit_page_view(text, boolean) to anon, authenticated;
