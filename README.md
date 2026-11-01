# Nossia

**Make time for us.**

Nossia is a private web application designed for couples to discover activities, plan dates, and preserve memories of the experiences they share.

The project combines activity recommendations, personalized planning, a shared experience diary, and contextual information to help couples spend meaningful time together.

> **Project status:** In development.

## Table of Contents

- [Overview](#overview)
- [Objectives](#objectives)
- [Available in this release](#available-in-this-release)
- [Technology Stack](#technology-stack)
- [Architecture](#architecture)
- [Getting Started](#getting-started)
- [Environment Variables](#environment-variables)
- [Development Workflow](#development-workflow)
- [Documentation](#documentation)
- [Security and Privacy](#security-and-privacy)
- [Remaining Roadmap](#remaining-roadmap)
- [License](#license)

## Overview

Nossia is a private web app for couples, with a login for each partner. Couples can collect date ideas, plan activities, save favourites and keep notes, ratings, and locations for dates they have experienced.

The first release stores a couple profile, date ideas, locations, and photo-album metadata in Supabase PostgreSQL. Supabase Auth protects the account, and database Row Level Security restricts records to that couple. Private photos are stored in Supabase Storage. OpenStreetMap powers date maps and place search.

## Objectives

- Make discovering date ideas simple and engaging.
- Encourage couples to try new experiences.
- Avoid repeatedly suggesting activities already completed, unless repetition is explicitly requested.
- Keep plans, experiences, and memories organized in one place.
- Provide a private, shared space for preserving memories.
- Offer a responsive experience across desktop and mobile devices.

## Available in this release

- A couple space with both names and optional birthdays. The partner who signs up can create a single-use invite link (valid for 14 days) from the couple profile so the other partner gets their own login to the same dates, ideas and memories.
- Required relationship anniversary and optional first-met, first-message, and first-date dates.
- Edit the couple names and important dates from the profile button in the header, and upload a shared profile photo stored privately in Supabase Storage.
- A prominent anniversary countdown and relationship-duration counter with a selectable days, months, or years metric. Anniversary planning starts with the couple's most common completed-date mood when available, then lets them refine the idea with Feeling.
- An English/European Portuguese language switch in the app header; the selected language is remembered on the current device.
- Shared date ideas, categories, favourites, and planned dates.
- Add and edit date ideas, or permanently delete an idea and its attached stored photos.
- Import date ideas from an `.xlsx` workbook or `.csv` file after reviewing valid ideas and rejected rows. Imports are limited to 2 MB and 200 data rows at a time.
- One shared idea catalog for every couple, plus private ideas each couple adds or imports. Favourites, plans and memories stay couple-specific, and planning an idea creates a separate date, so the same idea can be lived more than once. Catalog uploads are restricted to the configured catalog administrator and support up to 5,000 ideas per file.
- A random date draw that chooses from unplanned ideas and prefers a different idea on each result.
- Two recommendation modes: an instant random draw (up to three results per draw session) or an interactive, one-question-at-a-time Feeling flow matching mood, duration, budget, distance, and optional things to avoid. Matching ideas remain visible and update as answers change.
- Date ideas include matching metadata for mood, duration in minutes, approximate budget for two, whether it can be done at home, and estimated one-way travel time.
- Choosing a suggested date plans it for today; choosing another day is a separate action.
- Completed-date memories with optional notes, ratings, and location.
- Choose either partner's home as a planned or completed date location; statistics show the number of dates at home and which partner's home is most frequent.
- Set or change the home location of a completed memory later from its Memories card without changing its date or other details.
- A monthly calendar showing planned dates and completed memories, with unscheduled plans listed separately.
- A Today page (`/hoje`, the default after sign-in) with the next date, a one-step way to plan a date from a few words, the time you are both free, a weekend suggestion and upcoming special dates.
- A Places page (`/sitios`) that asks Google Places for restaurants, cafés or bars by price, distance, cuisine and opening, ranks them and shows three at a time with photo, rating, price and distance. Places can be saved, planned as a date (with the map pin filled in), opened in Google Maps or looked up on TheFork, and each partner rates them separately. Only the Google place ID and the couple's own label are stored. The search runs in a Vercel function (`api/places.ts`) that needs `GOOGLE_MAPS_API_KEY` and only answers signed-in users.
- An Agenda page (`/agenda`) with each partner's fixed weekly work hours, the time you are both free over the next 7 days, and couple tasks that can belong to one partner or both.
- Planned dates can have an optional start time.
- A private calendar feed per partner (`/api/calendar?token=…`) to subscribe to in the iPhone Calendar (or any app that reads `.ics`). It carries planned dates, that partner's open tasks and shared ones, the anniversary and birthdays. The feed endpoint is a Vercel function that reads `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (or `SUPABASE_URL` / `SUPABASE_ANON_KEY`); times use the Europe/Lisbon time zone.
- An OpenStreetMap view for planned and completed dates. Choose a place from search results to save a private map pin.
- A weather panel with a seven-day forecast for a manually selected city or GPS location. On first use, the app asks before requesting GPS; the choice is saved to the couple's shared profile.
- Activity-specific weather-aware random and Feeling recommendations that consider rain probability, feels-like temperatures, wind, UV, daylight, and sunshine for relevant activities such as hikes, picnics, beaches, and photography. Weather changes suggestion ranking and draw odds but never excludes an idea; rain is not treated as a blanket reason to stay indoors. A planned date shows its forecast when available.
- English and European Portuguese interfaces and an “Our stats” view with completed dates, distinct activities, unique places, average rating, estimated spend, dates this month, and favourite category. After five completed dates, the couple profile highlights the two most common moods.
- Couple milestones and the relationship anniversary are visually separated from each partner's personal birthday. Within 30 days of the anniversary, the home page shows a reminder and a shared-experience gift idea.
- A non-decaying couple companion on the Dates page earns 25 XP for every completed date and grows through five visual stages. Its progress is calculated from shared memories, so there is no weekly streak or loss of progress when the couple takes a break.
- Private photo albums for completed dates, accessible while saving a memory or later from the Memories view, with uploads restricted to supported image formats up to 10 MB each.
- Password reset by email, followed by a secure password update through the recovery link.
- Replanning a completed date creates a separate planned entry and keeps the original memory.
- A proposal prompt linking to the supplied interactive page.

The couple profile is calculated from the mood tags on completed date ideas; it is not a psychological assessment. “Surprise me” dates are excluded from mood rankings.

### Date idea fields and Feeling matching

Use one row per idea when importing an existing list. The app accepts `.xlsx` and `.csv` files (comma- or semicolon-delimited CSV); download the CSV template from the import dialog. Header names are case-insensitive. Common Portuguese equivalents are also accepted for title, description, mood, duration, budget, at-home, travel time, and category.

| Column | Required | Meaning / allowed values |
|---|---:|---|
| `title` | Yes | Short date-idea name. |
| `description` | Yes | What the couple will do. |
| `mood` | Yes | `Romantic`, `Fun`, `Relaxing`, `Adventure`, `Creative`, or `Surprise me`. |
| `duration_minutes` | Yes | Estimated total time in minutes (for example, `90`). |
| `budget_eur` | Yes | Estimated total cost for both people in euros (for example, `30`). |
| `at_home` | Yes | `true` or `false`. |
| `travel_minutes` | No | Estimated one-way travel time in minutes; leave blank if unknown. Use `0` for at-home activities. |
| `category` | No | `Romantic`, `Adventure`, `Food & drink`, `Creative`, `Relaxing`, or `Culture`. When blank, it is derived from the mood. |
| `weather_setting` | No | `any`, `indoor`, or `outdoor`. Defaults to `indoor` for ideas marked `at_home`, otherwise `any`. |
| `emoji` | No | Optional display emoji. |

Each row must include a title, description, supported mood, positive whole-number duration in minutes, non-negative budget in euros, and `true`/`false` value for `at_home`. The preview shows validation errors by row; only valid rows can be imported.

Example:

```csv
title,description,mood,duration_minutes,budget_eur,at_home,travel_minutes,emoji
"Sunset picnic","Pack a basket and watch the sunset together.",Romantic,150,30,false,30,🧺
"Cook something new","Choose a cuisine and make dinner together.",Fun,90,10,true,0,🍝
```

Feeling first considers unplanned ideas, then progressively applies the selected mood, duration, budget, distance, and optional exclusions. Matching suggestions are shown alongside the current question and can be chosen at any point. “At home” matches ideas marked `at_home`; the 30-minute and one-hour choices match ideas marked at home or with a known travel time within that limit. “No limit” does not filter by travel or budget. The anniversary shortcut starts with the couple's most common completed-date mood, if one exists, and the same Feeling flow can refine that recommendation. The days/months/years relationship counter remembers its selected metric on the current device. Random mode makes at most three draws in its current draw session and favours ideas not already shown.

Weather suggestions use the saved forecast location and remain optional. On first use, a consent prompt appears before requesting GPS; choosing “Not now” dismisses the prompt on that device, while a city can be searched manually or the location can be set later. The selected location is saved to the couple's shared profile. The seven-day Open-Meteo forecast informs per-activity suitability using rain, apparent temperature, wind, UV, daylight, and sunshine where relevant. Weather ranks suggestions and weights random draws, but never removes a date idea from the pool; an outdoor activity can still be chosen on a rainy day. Indoor ideas are treated as weather-insensitive, beach plans benefit from warmth, picnics from comfortable temperatures and light wind, hikes from safe temperatures and daylight, and cloud can be favourable for photography. The optional “things to avoid” answer is still available for immediate restrictions.

## Technology Stack

| Technology | Purpose |
|---|---|
| React | User interface |
| TypeScript | Type safety |
| Vite | Development server and build tooling |
| CSS | Styling and responsive design |
| Supabase Auth | Authentication |
| Supabase PostgreSQL | Application data |
| Supabase Storage | Private photo storage |
| OpenStreetMap | Map tiles and place search |
| Open-Meteo | Seven-day weather forecasts |
| Git and GitHub | Version control and project management |
| Vercel | Web application deployment |

## Architecture

Nossia follows a frontend-first architecture supported by Supabase services.

- **Frontend:** React, TypeScript, and Vite.
- **Authentication:** Supabase Auth.
- **Database:** PostgreSQL managed by Supabase.
- **File storage:** Private Supabase Storage bucket with couple-scoped access policies.
- **Maps and place search:** OpenStreetMap tiles and a user-triggered place search.
- **Weather:** Open-Meteo forecasts using couple-selected coordinates.
- **Deployment:** Vercel, integrated with the GitHub repository.

Database access must be protected by Row Level Security (RLS). Server-side secrets must never be exposed in client-side code.

## Getting Started

### Prerequisites

Install the following tools:

- Node.js LTS
- npm
- Git
- A GitHub account
- A Supabase project

### Local development

```bash
npm install
npm run dev
```

Copy `.env.example` to `.env.local` and add the Supabase project URL and publishable/anonymous key. The app displays setup guidance and does not pretend data is syncing when these settings are absent.

### Database setup

Apply the SQL migrations, in filename order, from the [`supabase/migrations`](./supabase/migrations) directory to your Supabase project using the Supabase SQL Editor or Supabase CLI:

1. [`20261013000000_initial_couple_app.sql`](./supabase/migrations/20261013000000_initial_couple_app.sql)
2. [`20261013230000_calendar_map_photo_albums.sql`](./supabase/migrations/20261013230000_calendar_map_photo_albums.sql)
3. [`20261013233000_nossia_feeling_recommendations.sql`](./supabase/migrations/20261013233000_nossia_feeling_recommendations.sql)
4. [`20261014000000_shared_date_idea_catalog.sql`](./supabase/migrations/20261014000000_shared_date_idea_catalog.sql)
5. [`20261014010000_weather_preferences.sql`](./supabase/migrations/20261014010000_weather_preferences.sql)
6. [`20261014020000_saved_home_locations.sql`](./supabase/migrations/20261014020000_saved_home_locations.sql)
7. [`20261016010000_couple_profile_photo.sql`](./supabase/migrations/20261016010000_couple_profile_photo.sql)

The initial migration creates the couple profile and date-ideas tables, row-level access policies, and an Auth trigger that creates the couple profile from sign-up metadata. The second migration adds date coordinates, the private photo-albums table, the `date-photos` Storage bucket, and couple-scoped policies for photo records and files. The third adds the metadata used by Feeling recommendations. The fourth creates the shared default-idea catalog, its administrator-only write policies, and links existing starter ideas to their templates. The fifth adds saved weather coordinates and indoor/outdoor metadata. The sixth adds a private per-date marker for either partner's home. The seventh adds the shared couple-profile photo path; it reuses the private `date-photos` bucket and its couple-scoped storage policies. If migrations one through six have already been applied, apply only the new seventh migration.

To enable global catalog uploads for the app owner, set the `catalog_admin` flag in that owner's Supabase **app metadata**. Run this in the Supabase SQL Editor after replacing the email with the account's sign-in email:

```sql
update auth.users
set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"catalog_admin": true}'::jsonb
where email = 'YOUR_LOGIN_EMAIL';
```

The SQL policy checks this signed app-metadata claim, so changing browser-side data cannot grant catalog access. Sign out and back in after setting the flag so the new claim is included in the session. Only mark the app owner's account as an administrator.

In Supabase Auth, configure the site URL and allowed redirect URLs for your local app and deployed domain. Password recovery returns to `/recover`, so allow `https://nossia.vercel.app/recover` (or `https://nossia.vercel.app/**`) in the redirect URLs. If the Vercel domain changes, update the allowed redirects and Site URL accordingly. The Supabase project and credentials do not need to change. Email confirmation can be enabled in the Supabase Auth settings.

The app uses browser routes for `/signin`, `/signup`, `/recover`, and `/update-password`, plus `/dates`, `/planned`, `/memories`, `/calendar`, `/favorites`, `/map`, and `/insights` after sign-in. The Vercel rewrite serves the SPA entry point for direct links and page refreshes.

### Deploying to Vercel

Import the GitHub repository into Vercel and add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` to the project's environment variables for each deployment environment. Redeploy after changing environment variables. Never use a Supabase service-role key in the frontend.

Create a production build locally with:

```bash
npm run build
```

## Environment Variables

The application uses the following browser-safe client configuration:

```dotenv
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
```

Use the Supabase publishable/anonymous key only. The schema's Row Level Security policies are responsible for protecting private data.

**Never commit `.env.local`, database passwords, service-role keys, or other private credentials.** Only public client configuration intended for browser use may be exposed to the frontend. Access to private data must be enforced through database and storage policies.

## Development Workflow

1. Create an Issue describing the task.
2. Associate it with the appropriate milestone and GitHub Project.
3. Create a branch from the main development branch.
4. Implement the change and run the relevant checks.
5. Open a Pull Request with a description and testing information.
6. Review and merge the change once the acceptance criteria are met.

Use descriptive branch names, such as:

- `feature/activity-draw`
- `feature/experience-diary`
- `fix/activity-filter`
- `docs/project-architecture`

## Documentation

The GitHub Wiki contains the detailed project documentation, including:

- Product vision and requirements.
- System architecture and data model.
- Security and privacy policies.
- User interface design.
- Development phases and backlog.
- Testing and deployment procedures.
- Technical decision records.

## Security and Privacy

Nossia is intended to store personal plans, notes, and photographs.

The implementation must enforce:

- Authentication for private application areas.
- Couple-level authorization for shared records.
- Row Level Security on private database tables.
- Restricted access to stored photographs through both database and Storage policies.
- Secure handling of credentials and environment variables.
- Explicit permission before accessing device location.
- Place searches are sent to OpenStreetMap's Nominatim service only when a user chooses to search. The app asks before requesting GPS; coordinates are stored in the couple's shared profile and sent to Open-Meteo to retrieve the forecast.
- Appropriate error handling without exposing sensitive information.

## Remaining roadmap

1. Add persistent notifications and reminders.
2. Add couple-profile editing and plan cancellation.
3. Add a named AI companion that grows with shared experiences, uses both partners' interests, and recommends timely events and getaways; the current non-AI companion establishes its first visual and XP progression.
4. Refine weather suitability by activity using precipitation amount, forecast timing, route/exposure, and user-selected activity metadata.

The app is intended to deploy as a Vercel web app connected to a Supabase project, with its source hosted on GitHub.