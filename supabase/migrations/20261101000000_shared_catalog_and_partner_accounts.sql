-- Phase 0: one login per partner, one shared idea catalog, and dates that point at ideas.
--
-- Before: one auth user per couple, and every couple received its own copy of every
-- catalog idea in date_ideas, which also held plans and memories.
-- After:
--   couple_members        each partner's own login, linked to the couple
--   couple_invites        single-use links that let the second partner join
--   ideas                 the shared catalog (public) plus each couple's private ideas
--   couple_idea_favorites favourites per couple
--   couple_dates          planned and completed dates, each pointing at one idea

-- Couple membership -----------------------------------------------------------

create table public.couple_members (
  couple_id uuid not null references public.couples(id) on delete cascade,
  user_id uuid not null unique references auth.users(id) on delete cascade,
  partner_slot text not null check (partner_slot in ('partner_one', 'partner_two')),
  joined_at timestamptz not null default now(),
  primary key (couple_id, partner_slot)
);

insert into public.couple_members (couple_id, user_id, partner_slot, joined_at)
select id, account_user_id, 'partner_one', created_at
from public.couples;

create function public.is_couple_member(target_couple_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.couple_members
    where couple_id = target_couple_id and user_id = (select auth.uid())
  );
$$;

revoke execute on function public.is_couple_member(uuid) from public, anon;
grant execute on function public.is_couple_member(uuid) to authenticated;

alter table public.couple_members enable row level security;
grant select on public.couple_members to authenticated;

create policy "Members can see who belongs to their couple"
  on public.couple_members for select
  to authenticated
  using (public.is_couple_member(couple_id));

drop policy if exists "Couples can read their own profile" on public.couples;
drop policy if exists "Couples can update their own profile" on public.couples;

create policy "Members can read their couple profile"
  on public.couples for select
  to authenticated
  using (public.is_couple_member(id));

create policy "Members can update their couple profile"
  on public.couples for update
  to authenticated
  using (public.is_couple_member(id))
  with check (public.is_couple_member(id));

-- Partner invites -------------------------------------------------------------

create table public.couple_invites (
  code text primary key,
  couple_id uuid not null references public.couples(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_by uuid references auth.users(id) on delete set null,
  used_at timestamptz
);

create index couple_invites_couple_idx on public.couple_invites (couple_id, created_at desc);

-- Invites are only reachable through the functions below.
alter table public.couple_invites enable row level security;

create function public.create_couple_invite()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  member_couple_id uuid;
  existing_code text;
  new_code text;
begin
  select couple_id into member_couple_id
  from public.couple_members
  where user_id = (select auth.uid());

  if member_couple_id is null then
    raise exception 'You are not part of a couple yet.';
  end if;

  if exists (
    select 1 from public.couple_members
    where couple_id = member_couple_id and partner_slot = 'partner_two'
  ) then
    raise exception 'Your partner already has their own account.';
  end if;

  select code into existing_code
  from public.couple_invites
  where couple_id = member_couple_id and used_at is null and expires_at > now()
  order by created_at desc
  limit 1;

  if existing_code is not null then
    return existing_code;
  end if;

  new_code := replace(gen_random_uuid()::text, '-', '');
  insert into public.couple_invites (code, couple_id, created_by, expires_at)
  values (new_code, member_couple_id, (select auth.uid()), now() + interval '14 days');
  return new_code;
end;
$$;

revoke execute on function public.create_couple_invite() from public, anon;
grant execute on function public.create_couple_invite() to authenticated;

-- Lets the invite page greet the partner before they create their account.
create function public.get_couple_invite(invite_code text)
returns table (partner_one_name text, partner_two_name text)
language sql
stable
security definer
set search_path = ''
as $$
  select couple.partner_one_name, couple.partner_two_name
  from public.couple_invites as invite
  join public.couples as couple on couple.id = invite.couple_id
  where invite.code = invite_code
    and invite.used_at is null
    and invite.expires_at > now()
    and not exists (
      select 1 from public.couple_members
      where couple_id = invite.couple_id and partner_slot = 'partner_two'
    );
$$;

revoke execute on function public.get_couple_invite(text) from public;
grant execute on function public.get_couple_invite(text) to anon, authenticated;

-- New accounts either join a couple through an invite or start a new couple.
create or replace function public.create_couple_for_new_account()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  invite_code text := nullif(new.raw_user_meta_data ->> 'invite_code', '');
  invite public.couple_invites%rowtype;
  new_couple_id uuid;
begin
  if invite_code is not null then
    select * into invite
    from public.couple_invites
    where code = invite_code and used_at is null and expires_at > now()
    for update;

    if not found then
      raise exception 'This invite link is invalid or has expired.';
    end if;

    insert into public.couple_members (couple_id, user_id, partner_slot)
    values (invite.couple_id, new.id, 'partner_two');

    update public.couple_invites
    set used_by = new.id, used_at = now()
    where code = invite.code;

    if nullif(new.raw_user_meta_data ->> 'partner_name', '') is not null then
      update public.couples
      set partner_two_name = new.raw_user_meta_data ->> 'partner_name', updated_at = now()
      where id = invite.couple_id;
    end if;

    return new;
  end if;

  insert into public.couples (
    account_user_id,
    partner_one_name,
    partner_two_name,
    partner_one_birth_date,
    partner_two_birth_date,
    relationship_date,
    first_met_date,
    first_message_date,
    first_date_date
  )
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data ->> 'partner_one_name', ''), 'Partner 1'),
    coalesce(nullif(new.raw_user_meta_data ->> 'partner_two_name', ''), 'Partner 2'),
    nullif(new.raw_user_meta_data ->> 'partner_one_birth_date', '')::date,
    nullif(new.raw_user_meta_data ->> 'partner_two_birth_date', '')::date,
    (new.raw_user_meta_data ->> 'relationship_date')::date,
    nullif(new.raw_user_meta_data ->> 'first_met_date', '')::date,
    nullif(new.raw_user_meta_data ->> 'first_message_date', '')::date,
    nullif(new.raw_user_meta_data ->> 'first_date_date', '')::date
  )
  returning id into new_couple_id;

  insert into public.couple_members (couple_id, user_id, partner_slot)
  values (new_couple_id, new.id, 'partner_one');

  return new;
end;
$$;

-- Shared idea catalog ---------------------------------------------------------

drop policy if exists "Authenticated couples can read default date ideas" on public.date_idea_templates;
drop policy if exists "Catalog admins can add default date ideas" on public.date_idea_templates;
drop policy if exists "Catalog admins can update default date ideas" on public.date_idea_templates;
drop policy if exists "Catalog admins can delete default date ideas" on public.date_idea_templates;

alter table public.date_idea_templates rename to ideas;
alter index public.date_idea_templates_mood_duration_idx rename to ideas_mood_duration_idx;

-- Null means a public catalog idea; otherwise the idea is private to that couple.
alter table public.ideas
  add column created_by_couple_id uuid references public.couples(id) on delete cascade,
  alter column duration_minutes drop not null,
  alter column budget_eur drop not null;

alter table public.ideas drop constraint if exists date_idea_templates_title_description_key;
alter table public.ideas
  add constraint ideas_owner_title_description_key
  unique nulls not distinct (created_by_couple_id, title, description);

create policy "Couples can read public ideas and their own"
  on public.ideas for select
  to authenticated
  using (created_by_couple_id is null or public.is_couple_member(created_by_couple_id));

create policy "Couples add their own ideas and admins add public ones"
  on public.ideas for insert
  to authenticated
  with check (
    (created_by_couple_id is not null and public.is_couple_member(created_by_couple_id))
    or (created_by_couple_id is null and (select auth.jwt() -> 'app_metadata' ->> 'catalog_admin') = 'true')
  );

create policy "Couples edit their own ideas and admins edit public ones"
  on public.ideas for update
  to authenticated
  using (
    (created_by_couple_id is not null and public.is_couple_member(created_by_couple_id))
    or (created_by_couple_id is null and (select auth.jwt() -> 'app_metadata' ->> 'catalog_admin') = 'true')
  )
  with check (
    (created_by_couple_id is not null and public.is_couple_member(created_by_couple_id))
    or (created_by_couple_id is null and (select auth.jwt() -> 'app_metadata' ->> 'catalog_admin') = 'true')
  );

create policy "Couples delete their own ideas and admins delete public ones"
  on public.ideas for delete
  to authenticated
  using (
    (created_by_couple_id is not null and public.is_couple_member(created_by_couple_id))
    or (created_by_couple_id is null and (select auth.jwt() -> 'app_metadata' ->> 'catalog_admin') = 'true')
  );

-- Link every existing couple row to a catalog idea ------------------------------

alter table public.date_ideas add column idea_id uuid;

update public.date_ideas
set idea_id = source_template_id
where source_template_id is not null;

-- Repeated dates were copied without their catalog link; match them back by content.
update public.date_ideas as couple_idea
set idea_id = idea.id
from public.ideas as idea
where couple_idea.idea_id is null
  and idea.created_by_couple_id is null
  and idea.title = couple_idea.title
  and idea.description = couple_idea.description;

-- Whatever is left was written by the couple: keep one private idea per title and description.
insert into public.ideas (
  created_by_couple_id, title, description, category, duration, budget, emoji, mood,
  duration_minutes, budget_eur, travel_minutes, at_home, weather_setting, created_at
)
select distinct on (couple_id, title, description)
  couple_id, title, description, category, duration, budget, emoji, mood,
  duration_minutes, budget_eur, travel_minutes, at_home, weather_setting, created_at
from public.date_ideas
where idea_id is null
order by couple_id, title, description, created_at desc
on conflict do nothing;

update public.date_ideas as couple_idea
set idea_id = idea.id
from public.ideas as idea
where couple_idea.idea_id is null
  and idea.created_by_couple_id = couple_idea.couple_id
  and idea.title = couple_idea.title
  and idea.description = couple_idea.description;

-- Favourites ------------------------------------------------------------------

create table public.couple_idea_favorites (
  couple_id uuid not null references public.couples(id) on delete cascade,
  idea_id uuid not null references public.ideas(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (couple_id, idea_id)
);

insert into public.couple_idea_favorites (couple_id, idea_id)
select distinct couple_id, idea_id
from public.date_ideas
where favorite and idea_id is not null
on conflict do nothing;

alter table public.couple_idea_favorites enable row level security;
grant select, insert, delete on public.couple_idea_favorites to authenticated;

create policy "Members can read their favourites"
  on public.couple_idea_favorites for select
  to authenticated
  using (public.is_couple_member(couple_id));

create policy "Members can add favourites"
  on public.couple_idea_favorites for insert
  to authenticated
  with check (
    public.is_couple_member(couple_id)
    and exists (
      select 1 from public.ideas
      where id = idea_id and (created_by_couple_id is null or created_by_couple_id = couple_idea_favorites.couple_id)
    )
  );

create policy "Members can remove favourites"
  on public.couple_idea_favorites for delete
  to authenticated
  using (public.is_couple_member(couple_id));

-- Couple dates ----------------------------------------------------------------

drop policy if exists "Couples can read their own date ideas" on public.date_ideas;
drop policy if exists "Couples can create their own date ideas" on public.date_ideas;
drop policy if exists "Couples can update their own date ideas" on public.date_ideas;
drop policy if exists "Couples can delete their own date ideas" on public.date_ideas;
drop policy if exists "Couples can read their own date photos" on public.date_photos;
drop policy if exists "Couples can add photos to their own dates" on public.date_photos;
drop policy if exists "Couples can remove photos from their own dates" on public.date_photos;

-- Unplanned rows were only per-couple copies of catalog ideas; they now live in ideas.
-- An unplanned row with photos is kept as a memory so no album is lost.
update public.date_ideas as couple_idea
set status = 'completed', completed_at = coalesce(completed_at, created_at::date)
where status = 'idea'
  and exists (select 1 from public.date_photos where date_idea_id = couple_idea.id);

delete from public.date_ideas where status = 'idea';

alter table public.date_ideas
  drop column title,
  drop column description,
  drop column category,
  drop column duration,
  drop column budget,
  drop column emoji,
  drop column favorite,
  drop column mood,
  drop column duration_minutes,
  drop column budget_eur,
  drop column travel_minutes,
  drop column at_home,
  drop column weather_setting,
  drop column source_template_id;

alter table public.date_ideas drop constraint if exists date_ideas_status_check;
alter table public.date_ideas
  alter column status set default 'planned',
  add constraint couple_dates_status_check check (status in ('planned', 'completed')),
  alter column idea_id set not null,
  add constraint couple_dates_idea_id_fkey foreign key (idea_id) references public.ideas(id) on delete restrict;

alter table public.date_ideas rename to couple_dates;
alter index public.date_ideas_couple_status_idx rename to couple_dates_couple_status_idx;
alter index public.date_ideas_couple_planned_idx rename to couple_dates_couple_planned_idx;
create index couple_dates_idea_idx on public.couple_dates (idea_id);

create policy "Members can read their dates"
  on public.couple_dates for select
  to authenticated
  using (public.is_couple_member(couple_id));

create policy "Members can plan dates"
  on public.couple_dates for insert
  to authenticated
  with check (
    public.is_couple_member(couple_id)
    and exists (
      select 1 from public.ideas
      where id = idea_id and (created_by_couple_id is null or created_by_couple_id = couple_dates.couple_id)
    )
  );

create policy "Members can update their dates"
  on public.couple_dates for update
  to authenticated
  using (public.is_couple_member(couple_id))
  with check (
    public.is_couple_member(couple_id)
    and exists (
      select 1 from public.ideas
      where id = idea_id and (created_by_couple_id is null or created_by_couple_id = couple_dates.couple_id)
    )
  );

create policy "Members can delete their dates"
  on public.couple_dates for delete
  to authenticated
  using (public.is_couple_member(couple_id));

-- Photos ----------------------------------------------------------------------

alter table public.date_photos rename column date_idea_id to date_id;

create policy "Members can read their date photos"
  on public.date_photos for select
  to authenticated
  using (public.is_couple_member(couple_id));

create policy "Members can add photos to their dates"
  on public.date_photos for insert
  to authenticated
  with check (
    public.is_couple_member(couple_id)
    and exists (
      select 1 from public.couple_dates
      where id = date_id and couple_id = date_photos.couple_id
    )
  );

create policy "Members can remove their date photos"
  on public.date_photos for delete
  to authenticated
  using (public.is_couple_member(couple_id));

drop policy if exists "Couples can read their own date photo files" on storage.objects;
drop policy if exists "Couples can upload their own date photo files" on storage.objects;
drop policy if exists "Couples can remove their own date photo files" on storage.objects;

create policy "Members can read their couple's photo files"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'date-photos'
    and (storage.foldername(name))[1] in (
      select couple_id::text from public.couple_members
      where user_id = (select auth.uid())
    )
  );

create policy "Members can upload their couple's photo files"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'date-photos'
    and (storage.foldername(name))[1] in (
      select couple_id::text from public.couple_members
      where user_id = (select auth.uid())
    )
  );

create policy "Members can remove their couple's photo files"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'date-photos'
    and (storage.foldername(name))[1] in (
      select couple_id::text from public.couple_members
      where user_id = (select auth.uid())
    )
  );
