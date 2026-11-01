-- ROOM ZERO initial Supabase schema
-- Enable Anonymous Sign-Ins in Supabase Authentication settings before using the app.
create extension if not exists pgcrypto;

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
   v_code:='';
   for i in 1..6 loop
     v_code:=v_code||substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', (get_byte(gen_random_bytes(1),0) % 32)+1, 1);
   end loop;
   exit when not exists(select 1 from public.rooms r where r.code=v_code);
   v_attempt:=v_attempt+1; if v_attempt>10 then raise exception 'Could not allocate room code'; end if;
 end loop;
 insert into public.rooms(code,host_id,capacity,game_mode) values(v_code,auth.uid(),p_capacity,p_game_mode) returning id into v_id;
 insert into public.room_members(room_id,user_id,display_name,is_host) values(v_id,auth.uid(),trim(p_display_name),true);
 return query select v_id,v_code;
end; $$;

create or replace function public.join_room(p_code text,p_display_name text)
returns uuid
language plpgsql security definer set search_path=public,auth
as $$
declare v_room public.rooms%rowtype;
begin
 if auth.uid() is null then raise exception 'Authentication required'; end if;
 if length(trim(p_display_name)) not between 1 and 18 then raise exception 'Invalid display name'; end if;
 select * into v_room from public.rooms where code=upper(trim(p_code)) and status='waiting' and expires_at>now() for update;
 if not found then raise exception 'Room not found or no longer accepting players'; end if;
 if (select count(*) from public.room_members where room_id=v_room.id)>=v_room.capacity then raise exception 'Room is full'; end if;
 insert into public.room_members(room_id,user_id,display_name) values(v_room.id,auth.uid(),trim(p_display_name))
 on conflict(room_id,user_id) do update set display_name=excluded.display_name,last_seen_at=now();
 return v_room.id;
end; $$;

grant execute on function public.create_room(text,integer,text) to authenticated;
grant execute on function public.join_room(text,text) to authenticated;

-- Enable Realtime for lobby roster and messages from Supabase Dashboard > Database > Publications
-- Add: rooms, room_members, room_messages to supabase_realtime.
