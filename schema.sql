-- ROOM ZERO initial Supabase schema
-- Enable Anonymous Sign-Ins in Supabase Authentication settings before using the app.
-- Room codes below use built-in PostgreSQL functions; no pgcrypto extension is required.

create table if not exists public.rooms (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[A-Z0-9]{6}$'),
  host_id uuid not null references auth.users(id) on delete cascade,
  capacity integer not null default 8 check (capacity between 2 and 50),
  game_mode text not null default 'brain' check (game_mode in ('brain','impostor','mystery')),
  status text not null default 'waiting' check (status in ('waiting','playing','finished','closed')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '8 hours')
);
create table if not exists public.room_members (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 18),
  is_host boolean not null default false,
  score integer not null default 0,
  joined_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  unique(room_id,user_id)
);
create table if not exists public.room_messages (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  display_name text not null,
  body text not null check (char_length(body) between 1 and 180),
  created_at timestamptz not null default now()
);
create index if not exists room_members_room_idx on public.room_members(room_id);
create index if not exists room_messages_room_time_idx on public.room_messages(room_id,created_at);

alter table public.rooms enable row level security;
alter table public.room_members enable row level security;
alter table public.room_messages enable row level security;

-- SECURITY DEFINER helper avoids recursive RLS evaluation on room_members.
create or replace function public.is_room_member(p_room_id uuid)
returns boolean
language sql stable security definer
set search_path=public,auth
as $$
  select exists(
    select 1 from public.room_members m
    where m.room_id=p_room_id and m.user_id=auth.uid()
  );
$$;
revoke all on function public.is_room_member(uuid) from public;
grant execute on function public.is_room_member(uuid) to authenticated;

-- A signed-in player can read room data only after joining that room.
drop policy if exists "members can read their rooms" on public.rooms;
create policy "members can read their rooms" on public.rooms for select to authenticated
using (public.is_room_member(rooms.id));

drop policy if exists "members can read room roster" on public.room_members;
create policy "members can read room roster" on public.room_members for select to authenticated
using (public.is_room_member(room_members.room_id));

drop policy if exists "members can read room messages" on public.room_messages;
create policy "members can read room messages" on public.room_messages for select to authenticated
using (public.is_room_member(room_messages.room_id));

drop policy if exists "members can send room messages" on public.room_messages;
create policy "members can send room messages" on public.room_messages for insert to authenticated
with check (user_id=auth.uid() and public.is_room_member(room_messages.room_id));

-- Room creation and joining are performed through RPC functions to enforce capacity and code rules.
create or replace function public.create_room(p_display_name text,p_capacity integer,p_game_mode text)
returns table(room_id uuid, room_code text)
language plpgsql security definer set search_path=public,auth
as $$
declare v_id uuid; v_code text; v_attempt integer:=0; i integer;
begin
 if auth.uid() is null then raise exception 'Authentication required'; end if;
 if length(trim(p_display_name)) not between 1 and 18 then raise exception 'Invalid display name'; end if;
 if p_capacity not between 2 and 50 then raise exception 'Capacity must be between 2 and 50'; end if;
 if p_game_mode not in ('brain','impostor','mystery') then raise exception 'Invalid game mode'; end if;
 loop
   -- Generate from the same unambiguous alphabet accepted by the UI.
   -- This avoids 0/O and 1/I transcription problems and keeps every code valid.
   v_code:='';
   for i in 1..6 loop
     v_code:=v_code || substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789',
       floor(random()*32)::integer + 1, 1);
   end loop;
   exit when not exists(select 1 from public.rooms r where r.code=v_code);
   v_attempt:=v_attempt+1;
   if v_attempt>20 then raise exception 'Could not allocate room code; please try again'; end if;
 end loop;
 insert into public.rooms(code,host_id,capacity,game_mode) values(v_code,auth.uid(),p_capacity,p_game_mode) returning id into v_id;
 insert into public.room_members(room_id,user_id,display_name,is_host) values(v_id,auth.uid(),trim(p_display_name),true);
 return query select v_id,v_code;
end; $$;

create or replace function public.join_room(p_code text,p_display_name text)
returns uuid
language plpgsql security definer set search_path=public,auth
as $$
declare v_room public.rooms%rowtype; v_existing boolean;
begin
 if auth.uid() is null then raise exception 'Authentication required'; end if;
 if length(trim(p_display_name)) not between 1 and 18 then raise exception 'Invalid display name'; end if;
 select * into v_room from public.rooms
   where code=upper(trim(p_code)) and status in ('waiting','playing') and expires_at>now()
   for update;
 if not found then raise exception 'Room not found, expired, or closed'; end if;
 select exists(select 1 from public.room_members where room_id=v_room.id and user_id=auth.uid())
   into v_existing;
 if v_existing then
   update public.room_members set display_name=trim(p_display_name),last_seen_at=now()
     where room_id=v_room.id and user_id=auth.uid();
   return v_room.id;
 end if;
 if v_room.status <> 'waiting' then raise exception 'This game has already started; only players who were already in the room can reconnect'; end if;
 if (select count(*) from public.room_members where room_id=v_room.id)>=v_room.capacity then
   raise exception 'Room is full';
 end if;
 insert into public.room_members(room_id,user_id,display_name)
   values(v_room.id,auth.uid(),trim(p_display_name));
 return v_room.id;
end; $$;

grant execute on function public.create_room(text,integer,text) to authenticated;
grant execute on function public.join_room(text,text) to authenticated;

-- Enable Realtime for lobby roster and messages from Supabase Dashboard > Database > Publications
-- Add: rooms, room_members, room_messages to supabase_realtime.


-- Multiplayer gameplay and reliable cross-device room synchronization.
alter table public.rooms
  add column if not exists game_state jsonb not null default '{}'::jsonb;

create table if not exists public.room_answers (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  question_index integer not null check (question_index >= 0),
  answer_index integer not null check (answer_index between 0 and 3),
  is_correct boolean not null,
  created_at timestamptz not null default now(),
  unique(room_id,user_id,question_index)
);
create index if not exists room_answers_room_question_idx
  on public.room_answers(room_id,question_index);

alter table public.room_answers enable row level security;
drop policy if exists "members can read room answers" on public.room_answers;
create policy "members can read room answers" on public.room_answers
  for select to authenticated using (public.is_room_member(room_answers.room_id));

-- The host can launch any of the three synchronized game modes.
create or replace function public.start_room(p_room_id uuid,p_game_mode text)
returns jsonb
language plpgsql security definer set search_path=public,auth
as $$
declare v_room public.rooms%rowtype; v_count integer; v_host_present boolean;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select * into v_room from public.rooms where id=p_room_id for update;
  if not found then raise exception 'Room not found'; end if;
  if v_room.host_id <> auth.uid() then raise exception 'Only the room host can start the game'; end if;
  if v_room.status <> 'waiting' then raise exception 'This room has already started'; end if;
  if p_game_mode not in ('brain','impostor','mystery') then raise exception 'Unknown game mode'; end if;
  -- The host is already a room member and counts as player 1.
  -- Capacity is only an upper limit; a room of size 4 can start with 2 players.
  select count(distinct user_id) into v_count
    from public.room_members where room_id=p_room_id;
  select exists(select 1 from public.room_members
    where room_id=p_room_id and user_id=v_room.host_id and is_host)
    into v_host_present;
  if not v_host_present then raise exception 'Room host membership is missing; recreate the room'; end if;
  if v_count < 2 then
    raise exception 'Waiting for another player: the host counts as one, and at least one other player must join (currently % players)', v_count;
  end if;
  delete from public.room_answers where room_id=p_room_id;
  update public.room_members as rm set score=0 where rm.room_id=p_room_id;
  update public.rooms
    set status='playing', game_mode=p_game_mode,
        game_state=jsonb_build_object('question_index',0,'started_at',now(),'round',1)
    where id=p_room_id;
  return (select game_state from public.rooms where id=p_room_id);
end;
$$;

-- Correct answers are checked on the server; the browser cannot award itself points.
drop function if exists public.submit_room_answer(uuid,integer,integer);
create function public.submit_room_answer(
  p_room_id uuid,p_question_index integer,p_answer_index integer
)
returns table(is_correct boolean,total_score integer)
language plpgsql security definer set search_path=public,auth
as $$
declare v_room public.rooms%rowtype; v_correct integer; v_ok boolean; v_score integer;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if p_answer_index not between 0 and 3 then raise exception 'Invalid answer choice'; end if;
  select * into v_room from public.rooms where id=p_room_id for update;
  if not found or not public.is_room_member(p_room_id) then raise exception 'You are not a member of this room'; end if;
  if v_room.status <> 'playing' or v_room.game_mode not in ('brain','impostor','mystery') then raise exception 'This game is not accepting answers'; end if;
  if p_question_index <> coalesce((v_room.game_state->>'question_index')::integer,0) then
    raise exception 'That question has already changed; wait for the current question';
  end if;
  -- Correct choices match the seven rounds for each mode in js/app.js.
  if v_room.game_mode='brain' then
    v_correct := (array[2,1,1,3,2,1,2])[mod(p_question_index,7)+1];
  elsif v_room.game_mode='impostor' then
    v_correct := (array[2,3,3,3,3,3,2])[mod(p_question_index,7)+1];
  else
    v_correct := (array[0,0,1,0,0,0,0])[mod(p_question_index,7)+1];
  end if;
  v_ok := (p_answer_index=v_correct);
  insert into public.room_answers(room_id,user_id,question_index,answer_index,is_correct)
    values(p_room_id,auth.uid(),p_question_index,p_answer_index,v_ok)
    on conflict(room_id,user_id,question_index) do nothing;
  if not found then raise exception 'You have already answered this question'; end if;
  if v_ok then
    update public.room_members as rm set score=rm.score+10,last_seen_at=now()
      where rm.room_id=p_room_id and rm.user_id=auth.uid();
  else
    update public.room_members as rm set last_seen_at=now()
      where rm.room_id=p_room_id and rm.user_id=auth.uid();
  end if;
  select rm.score into v_score from public.room_members as rm
    where rm.room_id=p_room_id and rm.user_id=auth.uid();
  return query select v_ok,v_score;
end;
$$;

create or replace function public.advance_room_question(p_room_id uuid)
returns jsonb
language plpgsql security definer set search_path=public,auth
as $$
declare v_room public.rooms%rowtype; v_next integer;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select * into v_room from public.rooms where id=p_room_id for update;
  if not found then raise exception 'Room not found'; end if;
  if v_room.host_id <> auth.uid() then raise exception 'Only the host can advance the question'; end if;
  if v_room.status <> 'playing' or v_room.game_mode not in ('brain','impostor','mystery') then raise exception 'No active game round'; end if;
  v_next := coalesce((v_room.game_state->>'question_index')::integer,0)+1;
  if v_next >= 7 then
    update public.rooms set status='finished',
      game_state=game_state || jsonb_build_object('finished_at',now())
      where id=p_room_id;
  else
    update public.rooms set game_state=game_state || jsonb_build_object('question_index',v_next,'round',v_next+1)
      where id=p_room_id;
  end if;
  return (select game_state from public.rooms where id=p_room_id);
end;
$$;

revoke all on function public.start_room(uuid,text) from public;
revoke all on function public.submit_room_answer(uuid,integer,integer) from public;
revoke all on function public.advance_room_question(uuid) from public;
grant execute on function public.start_room(uuid,text) to authenticated;
grant execute on function public.submit_room_answer(uuid,integer,integer) to authenticated;
grant execute on function public.advance_room_question(uuid) to authenticated;

-- Add the tables to Supabase Realtime when the publication is available.
-- The client also polls every 2.2 seconds as a fallback if Realtime is disabled.
do $$
begin
  if exists (select 1 from pg_publication where pubname='supabase_realtime') then
    if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='rooms') then
      alter publication supabase_realtime add table public.rooms;
    end if;
    if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='room_members') then
      alter publication supabase_realtime add table public.room_members;
    end if;
    if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='room_messages') then
      alter publication supabase_realtime add table public.room_messages;
    end if;
  end if;
end $$;
