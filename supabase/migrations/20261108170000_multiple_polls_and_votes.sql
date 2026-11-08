alter table public.polls
  drop constraint if exists polls_one_per_iso_week;

alter table public.polls
  drop column if exists week_start;

alter table public.polls
  add column if not exists creator_name text;

update public.polls as p
set creator_name = coalesce((
  select left(btrim(candidate), 100)
  from unnest(array[
    u.raw_user_meta_data ->> 'full_name',
    u.raw_user_meta_data ->> 'name',
    u.raw_user_meta_data ->> 'preferred_username',
    u.raw_user_meta_data ->> 'username'
  ]) as metadata(candidate)
  where nullif(btrim(candidate), '') is not null
    and position('@' in candidate) = 0
  limit 1
), 'Movie fan')
from auth.users as u
where u.id = p.user_id
  and p.creator_name is null;

update public.polls
set creator_name = 'Movie fan'
where creator_name is null;

alter table public.polls
  alter column creator_name set not null;

alter table public.votes
  drop constraint if exists votes_one_per_poll_per_user;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.votes'::regclass
      and conname = 'votes_one_per_option_per_user'
  ) then
    alter table public.votes
      add constraint votes_one_per_option_per_user
      unique (poll_id, user_id, option_id);
  end if;
end;
$$;

create or replace function public.create_poll(movies jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_poll_id uuid;
  v_creator_name text := 'Movie fan';
begin
  if v_user_id is null then
    raise exception 'You must be signed in to create a poll'
      using errcode = '42501';
  end if;

  select coalesce((
    select left(btrim(candidate), 100)
    from unnest(array[
      u.raw_user_meta_data ->> 'full_name',
      u.raw_user_meta_data ->> 'name',
      u.raw_user_meta_data ->> 'preferred_username',
      u.raw_user_meta_data ->> 'username'
    ]) as metadata(candidate)
    where nullif(btrim(candidate), '') is not null
      and position('@' in candidate) = 0
    limit 1
  ), 'Movie fan')
  into v_creator_name
  from auth.users as u
  where u.id = v_user_id;

  if movies is null or jsonb_typeof(movies) <> 'array' then
    raise exception 'A poll must contain between 1 and 5 movies'
      using errcode = '22023';
  end if;

  if jsonb_array_length(movies) < 1 or jsonb_array_length(movies) > 5 then
    raise exception 'A poll must contain between 1 and 5 movies'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(movies) as movie(value)
    where jsonb_typeof(movie.value) <> 'object'
       or not (movie.value ? 'tmdb_id')
       or jsonb_typeof(movie.value -> 'tmdb_id') <> 'number'
       or coalesce(movie.value ->> 'tmdb_id', '') !~ '^[1-9][0-9]*$'
       or not (movie.value ? 'title')
       or jsonb_typeof(movie.value -> 'title') <> 'string'
       or length(btrim(movie.value ->> 'title')) = 0
       or length(movie.value ->> 'title') > 300
       or (
         movie.value ? 'year'
         and jsonb_typeof(movie.value -> 'year') not in ('number', 'null')
       )
       or (
         jsonb_typeof(movie.value -> 'year') = 'number'
         and (
           movie.value ->> 'year' !~ '^[0-9]{4}$'
           or movie.value ->> 'year' not between '1870' and '2100'
         )
       )
       or (
         movie.value ? 'poster_path'
         and jsonb_typeof(movie.value -> 'poster_path') not in ('string', 'null')
       )
       or (
         jsonb_typeof(movie.value -> 'poster_path') = 'string'
         and movie.value ->> 'poster_path' !~ '^/[A-Za-z0-9._-]+$'
       )
  ) then
    raise exception 'Each movie must have a positive integer tmdb_id, a title, an optional year, and an optional poster_path'
      using errcode = '22023';
  end if;

  if (
    select count(distinct movie.value ->> 'tmdb_id')
    from jsonb_array_elements(movies) as movie(value)
  ) <> jsonb_array_length(movies) then
    raise exception 'A poll cannot contain the same TMDB movie more than once'
      using errcode = '22023';
  end if;

  insert into public.polls (user_id, creator_name)
  values (v_user_id, v_creator_name)
  returning id into v_poll_id;

  insert into public.poll_options (poll_id, tmdb_id, title, year, poster_path)
  select v_poll_id, movie.tmdb_id, movie.title, movie.year, movie.poster_path
  from jsonb_to_recordset(movies) as movie(
    tmdb_id bigint,
    title text,
    year integer,
    poster_path text
  );

  return v_poll_id;
end;
$$;

drop function if exists public.cast_vote(uuid, uuid);
drop function if exists public.cast_vote(uuid, uuid[]);

create function public.cast_vote(poll_id uuid, option_ids uuid[])
returns uuid[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_ends_at timestamptz;
  v_recorded_option_ids uuid[];
begin
  if v_user_id is null then
    raise exception 'You must be signed in to vote'
      using errcode = '42501';
  end if;

  select p.ends_at
    into v_ends_at
    from public.polls as p
    where p.id = cast_vote.poll_id;

  if not found then
    raise exception 'Poll not found'
      using errcode = '22023';
  end if;

  if option_ids is null or cardinality(option_ids) = 0 then
    raise exception 'Select at least one movie'
      using errcode = '22023';
  end if;

  if array_position(option_ids, null) is not null
     or cardinality(option_ids) <> (
       select count(distinct selected.option_id)
       from unnest(option_ids) as selected(option_id)
     ) then
    raise exception 'Each movie can only be selected once'
      using errcode = '22023';
  end if;

  if exists (
    select selected.option_id
    from unnest(option_ids) as selected(option_id)
    where not exists (
      select 1
      from public.poll_options as o
      where o.id = selected.option_id
        and o.poll_id = cast_vote.poll_id
    )
  ) then
    raise exception 'A selected movie does not belong to this poll'
      using errcode = '22023';
  end if;

  if clock_timestamp() >= v_ends_at then
    raise exception 'Voting has ended for this poll'
      using errcode = '22023';
  end if;

  insert into public.votes (poll_id, option_id, user_id)
  select cast_vote.poll_id, selected.option_id, v_user_id
  from unnest(option_ids) as selected(option_id)
  on conflict (poll_id, user_id, option_id) do nothing;

  select coalesce(array_agg(v.option_id), '{}'::uuid[])
    into v_recorded_option_ids
    from public.votes as v
    where v.poll_id = cast_vote.poll_id
      and v.user_id = v_user_id;

  return v_recorded_option_ids;
end;
$$;

drop function if exists public.get_poll_results(uuid);

create function public.get_poll_results(poll_id uuid)
returns table (option_id uuid, vote_count bigint, voter_count bigint)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ends_at timestamptz;
  v_voter_count bigint;
begin
  select p.ends_at
    into v_ends_at
    from public.polls as p
    where p.id = get_poll_results.poll_id;

  if not found or clock_timestamp() <= v_ends_at then
    return;
  end if;

  select count(distinct v.user_id)
    into v_voter_count
    from public.votes as v
    where v.poll_id = get_poll_results.poll_id;

  return query
    select o.id, count(v.id), v_voter_count
    from public.poll_options as o
    left join public.votes as v
      on v.poll_id = o.poll_id
      and v.option_id = o.id
    where o.poll_id = get_poll_results.poll_id
    group by o.id
    order by o.id;
end;
$$;

revoke all on function public.create_poll(jsonb) from public, anon, authenticated;
revoke all on function public.cast_vote(uuid, uuid[]) from public, anon, authenticated;
revoke all on function public.get_poll_results(uuid) from public, anon, authenticated;
grant execute on function public.create_poll(jsonb) to authenticated;
grant execute on function public.cast_vote(uuid, uuid[]) to authenticated;
grant execute on function public.get_poll_results(uuid) to anon, authenticated;
