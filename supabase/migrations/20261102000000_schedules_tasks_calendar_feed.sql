-- Phase 1: weekly work schedules, couple tasks, date start times and a private calendar
-- feed each partner can subscribe to from their phone.

-- Optional start time for planned dates, so they land at the right hour in calendars.
alter table public.couple_dates
  add column planned_start_time time;

-- Weekly work schedule ----------------------------------------------------------

-- weekday follows ISO 8601: 1 = Monday … 7 = Sunday. An end before the start means the
-- shift runs past midnight into the next day.
create table public.work_schedule_blocks (
  id uuid primary key default gen_random_uuid(),
  couple_id uuid not null references public.couples(id) on delete cascade,
  partner_slot text not null check (partner_slot in ('partner_one', 'partner_two')),
  weekday smallint not null check (weekday between 1 and 7),
  starts_at time not null,
  ends_at time not null check (ends_at <> starts_at),
  created_at timestamptz not null default now()
);

create index work_schedule_blocks_couple_idx on public.work_schedule_blocks (couple_id, partner_slot, weekday);

alter table public.work_schedule_blocks enable row level security;
grant select, insert, update, delete on public.work_schedule_blocks to authenticated;

create policy "Members can read their couple's schedules"
  on public.work_schedule_blocks for select
  to authenticated
  using (public.is_couple_member(couple_id));

create policy "Members can add schedule blocks"
  on public.work_schedule_blocks for insert
  to authenticated
  with check (public.is_couple_member(couple_id));

create policy "Members can change schedule blocks"
  on public.work_schedule_blocks for update
  to authenticated
  using (public.is_couple_member(couple_id))
  with check (public.is_couple_member(couple_id));

create policy "Members can remove schedule blocks"
  on public.work_schedule_blocks for delete
  to authenticated
  using (public.is_couple_member(couple_id));

-- Couple tasks ------------------------------------------------------------------

-- assigned_to null means the task belongs to both partners.
create table public.couple_tasks (
  id uuid primary key default gen_random_uuid(),
  couple_id uuid not null references public.couples(id) on delete cascade,
  title text not null check (length(trim(title)) between 1 and 200),
  notes text not null default '',
  due_date date,
  due_time time,
  assigned_to text check (assigned_to is null or assigned_to in ('partner_one', 'partner_two')),
  done_at timestamptz,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  check (due_time is null or due_date is not null)
);

create index couple_tasks_couple_due_idx on public.couple_tasks (couple_id, done_at, due_date);

alter table public.couple_tasks enable row level security;
grant select, insert, update, delete on public.couple_tasks to authenticated;

create policy "Members can read their tasks"
  on public.couple_tasks for select
  to authenticated
  using (public.is_couple_member(couple_id));

create policy "Members can add tasks"
  on public.couple_tasks for insert
  to authenticated
  with check (public.is_couple_member(couple_id));

create policy "Members can change tasks"
  on public.couple_tasks for update
  to authenticated
  using (public.is_couple_member(couple_id))
  with check (public.is_couple_member(couple_id));

create policy "Members can remove tasks"
  on public.couple_tasks for delete
  to authenticated
  using (public.is_couple_member(couple_id));

-- Calendar feeds ------------------------------------------------------------------

-- One secret feed link per partner. Calendar apps cannot sign in, so the token in the
-- link is the only credential; rotating it cuts off the old link.
create table public.calendar_feeds (
  token text primary key,
  user_id uuid not null unique references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.calendar_feeds enable row level security;

create function public.get_calendar_feed_token(rotate boolean default false)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  feed_token text;
begin
  if not exists (select 1 from public.couple_members where user_id = (select auth.uid())) then
    raise exception 'You are not part of a couple yet.';
  end if;

  if rotate then
    delete from public.calendar_feeds where user_id = (select auth.uid());
  end if;

  select token into feed_token from public.calendar_feeds where user_id = (select auth.uid());
  if feed_token is null then
    feed_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
    insert into public.calendar_feeds (token, user_id) values (feed_token, (select auth.uid()));
  end if;
  return feed_token;
end;
$$;

revoke execute on function public.get_calendar_feed_token(boolean) from public, anon;
grant execute on function public.get_calendar_feed_token(boolean) to authenticated;

-- Everything the feed endpoint needs to build the .ics file for one partner: their planned
-- dates, open tasks for them or for both, and the couple's yearly dates.
create function public.calendar_feed(feed_token text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with feed_member as (
    select member.couple_id, member.partner_slot
    from public.calendar_feeds as feed
    join public.couple_members as member on member.user_id = feed.user_id
    where feed.token = feed_token
  )
  select jsonb_build_object(
    'partner_slot', feed_member.partner_slot,
    'couple', (
      select jsonb_build_object(
        'id', couple.id,
        'partner_one_name', couple.partner_one_name,
        'partner_two_name', couple.partner_two_name,
        'partner_one_birth_date', couple.partner_one_birth_date,
        'partner_two_birth_date', couple.partner_two_birth_date,
        'relationship_date', couple.relationship_date
      )
      from public.couples as couple
      where couple.id = feed_member.couple_id
    ),
    'dates', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', couple_date.id,
        'title', idea.title,
        'description', idea.description,
        'emoji', idea.emoji,
        'planned_for', couple_date.planned_for,
        'planned_start_time', couple_date.planned_start_time,
        'duration_minutes', idea.duration_minutes,
        'location_name', couple_date.location_name
      ) order by couple_date.planned_for)
      from public.couple_dates as couple_date
      join public.ideas as idea on idea.id = couple_date.idea_id
      where couple_date.couple_id = feed_member.couple_id
        and couple_date.status = 'planned'
        and couple_date.planned_for is not null
    ), '[]'::jsonb),
    'tasks', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', task.id,
        'title', task.title,
        'notes', task.notes,
        'due_date', task.due_date,
        'due_time', task.due_time,
        'assigned_to', task.assigned_to
      ) order by task.due_date)
      from public.couple_tasks as task
      where task.couple_id = feed_member.couple_id
        and task.done_at is null
        and task.due_date is not null
        and (task.assigned_to is null or task.assigned_to = feed_member.partner_slot)
    ), '[]'::jsonb)
  )
  from feed_member;
$$;

revoke execute on function public.calendar_feed(text) from public;
grant execute on function public.calendar_feed(text) to anon, authenticated;
