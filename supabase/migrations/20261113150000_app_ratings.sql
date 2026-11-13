-- App ratings ("Đánh giá ứng dụng"): 1–5 stars and an optional comment, one per account (it can be changed later,
-- like a store review). Students write and read their own through submit_rating() / my_rating(); the admin page
-- reads all of them through admin_ratings() (accounts in app_admins only).

create table if not exists public.app_ratings (
  user_id uuid primary key references auth.users (id) on delete cascade,
  stars smallint not null check (stars between 1 and 5),
  comment text check (comment is null or char_length(comment) <= 1000),
  source text not null default 'app' check (source in ('app', 'map', 'profile')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.app_ratings enable row level security; -- no policies: only the functions below touch it

create or replace function public.submit_rating(p_stars int, p_comment text default null, p_source text default 'app')
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_comment text := nullif(btrim(regexp_replace(coalesce(p_comment, ''), E'[\\x01-\\x08\\x0b\\x0c\\x0e-\\x1f\\x7f]', '', 'g')), '');
begin
  if v_uid is null then raise exception 'login required' using errcode = '42501'; end if;
  if p_stars is null or p_stars < 1 or p_stars > 5 then raise exception 'stars must be 1-5'; end if;
  if v_comment is not null and char_length(v_comment) > 1000 then v_comment := left(v_comment, 1000); end if;
  insert into public.app_ratings (user_id, stars, comment, source)
  values (v_uid, p_stars, v_comment, case when p_source in ('app', 'map', 'profile') then p_source else 'app' end)
  on conflict (user_id) do update set stars = excluded.stars, comment = excluded.comment, updated_at = now();
  return json_build_object('stars', p_stars, 'comment', v_comment);
end;
$$;
revoke all on function public.submit_rating(int, text, text) from public, anon;
grant execute on function public.submit_rating(int, text, text) to authenticated;

create or replace function public.my_rating()
returns json
language sql
stable
security definer
set search_path = public
as $$
  select json_build_object('stars', stars, 'comment', comment, 'updated_at', updated_at)
  from public.app_ratings where user_id = auth.uid();
$$;
revoke all on function public.my_rating() from public, anon;
grant execute on function public.my_rating() to authenticated;

create or replace function public.admin_ratings()
returns json
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_out json;
begin
  if auth.uid() is null or not exists (select 1 from public.app_admins where user_id = auth.uid()) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select json_build_object(
    'count', (select count(*) from public.app_ratings),
    'avg', (select round(avg(stars)::numeric, 2) from public.app_ratings),
    'with_comment', (select count(*) from public.app_ratings where comment is not null),
    'dist', (select json_agg(json_build_object('stars', s, 'n', (select count(*) from public.app_ratings r where r.stars = s)) order by s desc)
             from generate_series(1, 5) s),
    'list', (select coalesce(json_agg(x order by x.at desc), '[]'::json) from (
        select coalesce(p.display_name, 'Sinh viên') as name, r.stars, r.comment, r.source,
          r.updated_at as at, r.updated_at > r.created_at + interval '1 minute' as edited
        from public.app_ratings r left join public.profiles p on p.id = r.user_id
        order by r.updated_at desc limit 2000
      ) x)
  ) into v_out;
  return v_out;
end;
$$;
revoke all on function public.admin_ratings() from public, anon;
grant execute on function public.admin_ratings() to authenticated;
