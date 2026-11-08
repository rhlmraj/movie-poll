drop trigger if exists polls_are_immutable on public.polls;

update public.polls as p
set creator_name = coalesce((
  select left(btrim(candidate), 100)
  from auth.users as u
  cross join lateral unnest(array[
    u.raw_user_meta_data ->> 'full_name',
    u.raw_user_meta_data ->> 'name',
    u.raw_user_meta_data ->> 'display_name',
    u.raw_user_meta_data ->> 'preferred_username',
    u.raw_user_meta_data ->> 'username',
    concat_ws(' ', u.raw_user_meta_data ->> 'given_name', u.raw_user_meta_data ->> 'family_name')
  ]) as metadata(candidate)
  where u.id = p.user_id
    and nullif(btrim(candidate), '') is not null
    and position('@' in candidate) = 0
  limit 1
), p.creator_name)
where p.creator_name = 'Movie fan';

create trigger polls_are_immutable
  before update or delete on public.polls
  for each row execute function public.prevent_poll_content_changes();

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
      u.raw_user_meta_data ->> 'display_name',
      u.raw_user_meta_data ->> 'preferred_username',
      u.raw_user_meta_data ->> 'username',
      concat_ws(' ', u.raw_user_meta_data ->> 'given_name', u.raw_user_meta_data ->> 'family_name')
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

drop function if exists public.cast_vote(uuid, uuid[]);

create function public.cast_vote(p_poll_id uuid, p_option_ids uuid[])
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
    where p.id = p_poll_id;

  if not found then
    raise exception 'Poll not found'
      using errcode = '22023';
  end if;

  if p_option_ids is null or cardinality(p_option_ids) = 0 then
    raise exception 'Select at least one movie'
      using errcode = '22023';
  end if;

  if array_position(p_option_ids, null) is not null
     or cardinality(p_option_ids) <> (
       select count(distinct selected.option_id)
       from unnest(p_option_ids) as selected(option_id)
     ) then
    raise exception 'Each movie can only be selected once'
      using errcode = '22023';
  end if;

  if exists (
    select selected.option_id
    from unnest(p_option_ids) as selected(option_id)
    where not exists (
      select 1
      from public.poll_options as o
      where o.id = selected.option_id
        and o.poll_id = p_poll_id
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
  select p_poll_id, selected.option_id, v_user_id
  from unnest(p_option_ids) as selected(option_id)
  on conflict (poll_id, user_id, option_id) do nothing;

  select coalesce(array_agg(v.option_id), '{}'::uuid[])
    into v_recorded_option_ids
    from public.votes as v
    where v.poll_id = p_poll_id
      and v.user_id = v_user_id;

  return v_recorded_option_ids;
end;
$$;

revoke all on function public.cast_vote(uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.cast_vote(uuid, uuid[]) to authenticated;

notify pgrst, 'reload schema';
