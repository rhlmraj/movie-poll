-- Poll weeks use UTC so the site-wide limit follows ISO weeks consistently for all clients.

create table public.polls (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  ends_at timestamptz not null default (now() + interval '48 hours'),
  week_start date generated always as (
    (date_trunc('week', created_at at time zone 'UTC'))::date
  ) stored,
  constraint polls_one_per_iso_week unique (week_start)
);

create table public.poll_options (
  id uuid primary key default gen_random_uuid(),
  poll_id uuid not null references public.polls (id) on delete restrict,
  tmdb_id bigint not null check (tmdb_id > 0),
  title text not null check (length(btrim(title)) > 0) check (length(title) <= 300),
  year integer check (year is null or year between 1870 and 2100),
  poster_path text check (poster_path is null or poster_path ~ '^/[A-Za-z0-9._-]+$'),
  constraint poll_options_one_tmdb_movie unique (poll_id, tmdb_id),
  constraint poll_options_poll_id_id_unique unique (poll_id, id)
);

create table public.votes (
  id uuid primary key default gen_random_uuid(),
  poll_id uuid not null references public.polls (id) on delete restrict,
  option_id uuid not null,
  user_id uuid not null references auth.users (id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  constraint votes_one_per_poll_per_user unique (poll_id, user_id),
  constraint votes_option_belongs_to_poll
    foreign key (poll_id, option_id)
    references public.poll_options (poll_id, id)
    on delete restrict
);

alter table public.polls enable row level security;
alter table public.poll_options enable row level security;
alter table public.votes enable row level security;

-- Polls are public, including while voting is open; this policy reveals no vote data.
create policy "Anyone can view polls"
  on public.polls for select
  using (true);

-- Movie choices are public so visitors can view poll contents without signing in.
create policy "Anyone can view poll options"
  on public.poll_options for select
  using (true);

-- A signed-in user can read only their own vote; other users' votes and counts stay private.
create policy "Users can view their own votes"
  on public.votes for select to authenticated
  using ((select auth.uid()) = user_id);

-- There are deliberately no client insert, update, or delete policies on these tables.
-- Poll creation and voting must go through the checked RPC functions below.

create or replace function public.prevent_poll_content_changes()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Polls and their options cannot be changed or deleted'
    using errcode = '55000';
end;
$$;

create trigger polls_are_immutable
  before update or delete on public.polls
  for each row execute function public.prevent_poll_content_changes();

create trigger poll_options_are_immutable
  before update or delete on public.poll_options
  for each row execute function public.prevent_poll_content_changes();

revoke all on function public.prevent_poll_content_changes() from public, anon, authenticated;

create or replace function public.create_poll(movies jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_poll_id uuid;
  v_constraint_name text;
begin
  if v_user_id is null then
    raise exception 'You must be signed in to create a poll'
      using errcode = '42501';
  end if;

  if movies is null or jsonb_typeof(movies) <> 'array' then
    raise exception 'A poll must contain exactly 5 movies'
      using errcode = '22023';
  end if;

  if jsonb_array_length(movies) <> 5 then
    raise exception 'A poll must contain exactly 5 movies'
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
  ) <> 5 then
    raise exception 'A poll cannot contain the same TMDB movie more than once'
      using errcode = '22023';
  end if;

  insert into public.polls (user_id)
  values (v_user_id)
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
exception
  when unique_violation then
    get stacked diagnostics v_constraint_name = constraint_name;
    if v_constraint_name = 'polls_one_per_iso_week' then
      raise exception 'A poll has already been created this week'
        using errcode = '23505';
    end if;
    raise;
end;
$$;

create or replace function public.cast_vote(poll_id uuid, option_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_ends_at timestamptz;
  v_vote_id uuid;
  v_constraint_name text;
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

  if not exists (
    select 1
    from public.poll_options as o
    where o.id = cast_vote.option_id
      and o.poll_id = cast_vote.poll_id
  ) then
    raise exception 'The selected option does not belong to this poll'
      using errcode = '22023';
  end if;

  if clock_timestamp() >= v_ends_at then
    raise exception 'Voting has ended for this poll'
      using errcode = '22023';
  end if;

  insert into public.votes (poll_id, option_id, user_id)
  values (cast_vote.poll_id, cast_vote.option_id, v_user_id)
  returning id into v_vote_id;

  return v_vote_id;
exception
  when unique_violation then
    get stacked diagnostics v_constraint_name = constraint_name;
    if v_constraint_name = 'votes_one_per_poll_per_user' then
      raise exception 'You have already voted in this poll'
        using errcode = '23505';
    end if;
    raise;
end;
$$;

create or replace function public.get_poll_results(poll_id uuid)
returns table (option_id uuid, vote_count bigint)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ends_at timestamptz;
begin
  select p.ends_at
    into v_ends_at
    from public.polls as p
    where p.id = get_poll_results.poll_id;

  if not found or clock_timestamp() <= v_ends_at then
    return;
  end if;

  return query
    select o.id, count(v.id)
    from public.poll_options as o
    left join public.votes as v
      on v.poll_id = o.poll_id
      and v.option_id = o.id
    where o.poll_id = get_poll_results.poll_id
    group by o.id
    order by o.id;
end;
$$;

-- Clients may read public poll content and a user's own vote, but cannot write tables directly.
revoke all on public.polls, public.poll_options, public.votes from anon, authenticated;
grant usage on schema public to anon, authenticated;
grant select on public.polls, public.poll_options to anon, authenticated;
grant select on public.votes to authenticated;

-- Poll creation and voting require an authenticated caller; results are public after a poll ends.
revoke all on function public.create_poll(jsonb) from public, anon, authenticated;
revoke all on function public.cast_vote(uuid, uuid) from public, anon, authenticated;
revoke all on function public.get_poll_results(uuid) from public, anon, authenticated;
grant execute on function public.create_poll(jsonb) to authenticated;
grant execute on function public.cast_vote(uuid, uuid) to authenticated;
grant execute on function public.get_poll_results(uuid) to anon, authenticated;
