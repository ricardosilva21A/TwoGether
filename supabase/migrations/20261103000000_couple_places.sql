-- Places the couple saves from Google Maps (restaurants, cafés, bars…), each partner's own
-- rating of them, and which dates happened there.
--
-- Google's terms allow keeping the place ID indefinitely; ratings, photos and opening hours
-- are fetched live and never stored. Name and address are the couple's own label for it.

create table public.couple_places (
  id uuid primary key default gen_random_uuid(),
  couple_id uuid not null references public.couples(id) on delete cascade,
  google_place_id text not null,
  name text not null check (length(trim(name)) between 1 and 200),
  address text not null default '',
  latitude double precision check (latitude between -90 and 90),
  longitude double precision check (longitude between -180 and 180),
  kind text not null default 'restaurant' check (kind in ('restaurant', 'cafe', 'bar')),
  notes text not null default '',
  created_at timestamptz not null default now(),
  unique (couple_id, google_place_id)
);

create index couple_places_couple_idx on public.couple_places (couple_id, created_at);

alter table public.couple_places enable row level security;
grant select, insert, update, delete on public.couple_places to authenticated;

create policy "Members can read their places"
  on public.couple_places for select
  to authenticated
  using (public.is_couple_member(couple_id));

create policy "Members can save places"
  on public.couple_places for insert
  to authenticated
  with check (public.is_couple_member(couple_id));

create policy "Members can edit their places"
  on public.couple_places for update
  to authenticated
  using (public.is_couple_member(couple_id))
  with check (public.is_couple_member(couple_id));

create policy "Members can remove their places"
  on public.couple_places for delete
  to authenticated
  using (public.is_couple_member(couple_id));

-- One rating per partner per place; each partner edits only their own.
create table public.place_ratings (
  place_id uuid not null references public.couple_places(id) on delete cascade,
  partner_slot text not null check (partner_slot in ('partner_one', 'partner_two')),
  rating smallint not null check (rating between 1 and 5),
  comment text not null default '',
  updated_at timestamptz not null default now(),
  primary key (place_id, partner_slot)
);

alter table public.place_ratings enable row level security;
grant select, insert, update, delete on public.place_ratings to authenticated;

create function public.my_partner_slot(target_couple_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select partner_slot from public.couple_members
  where couple_id = target_couple_id and user_id = (select auth.uid());
$$;

revoke execute on function public.my_partner_slot(uuid) from public, anon;
grant execute on function public.my_partner_slot(uuid) to authenticated;

create policy "Members can read their couple's ratings"
  on public.place_ratings for select
  to authenticated
  using (exists (
    select 1 from public.couple_places as place
    where place.id = place_id and public.is_couple_member(place.couple_id)
  ));

create policy "Partners add their own rating"
  on public.place_ratings for insert
  to authenticated
  with check (exists (
    select 1 from public.couple_places as place
    where place.id = place_id and public.my_partner_slot(place.couple_id) = partner_slot
  ));

create policy "Partners change their own rating"
  on public.place_ratings for update
  to authenticated
  using (exists (
    select 1 from public.couple_places as place
    where place.id = place_id and public.my_partner_slot(place.couple_id) = partner_slot
  ))
  with check (exists (
    select 1 from public.couple_places as place
    where place.id = place_id and public.my_partner_slot(place.couple_id) = partner_slot
  ));

create policy "Partners remove their own rating"
  on public.place_ratings for delete
  to authenticated
  using (exists (
    select 1 from public.couple_places as place
    where place.id = place_id and public.my_partner_slot(place.couple_id) = partner_slot
  ));

-- Dates can point at a saved place.
alter table public.couple_dates
  add column place_id uuid references public.couple_places(id) on delete set null;

create index couple_dates_place_idx on public.couple_dates (place_id);

drop policy if exists "Members can plan dates" on public.couple_dates;
drop policy if exists "Members can update their dates" on public.couple_dates;

create policy "Members can plan dates"
  on public.couple_dates for insert
  to authenticated
  with check (
    public.is_couple_member(couple_id)
    and exists (
      select 1 from public.ideas
      where id = idea_id and (created_by_couple_id is null or created_by_couple_id = couple_dates.couple_id)
    )
    and (place_id is null or exists (
      select 1 from public.couple_places where id = place_id and couple_id = couple_dates.couple_id
    ))
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
    and (place_id is null or exists (
      select 1 from public.couple_places where id = place_id and couple_id = couple_dates.couple_id
    ))
  );
