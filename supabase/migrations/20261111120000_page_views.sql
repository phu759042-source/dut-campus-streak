-- Visit counter for public web pages (for now only the 3D campus map at /map).
-- One row per page per day (Vietnam time). The table has RLS on and no policies, so the browser can
-- only reach it through hit_page_view(), which counts a visit and/or returns the totals.
create table if not exists public.page_views (
  page text not null,
  day date not null,
  views bigint not null default 0,
  primary key (page, day)
);
alter table public.page_views enable row level security;

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
  return json_build_object('total', v_total, 'today', v_today);
end;
$$;

revoke all on function public.hit_page_view(text, boolean) from public;
grant execute on function public.hit_page_view(text, boolean) to anon, authenticated;
