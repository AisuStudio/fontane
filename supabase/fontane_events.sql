-- Fontane.Studio mini analytics — one append-only events table.
-- Run this once in Fontane.Studio's own Supabase project (SQL Editor).

create table if not exists fontane_events (
  id bigint generated always as identity primary key,
  type text not null check (type in ('pageview', 'duration', 'export')),
  -- A same-day, non-reversible sha256 fingerprint of IP+User-Agent (see
  -- api/track/route.ts's dailyVisitorFingerprint), NOT a persistent id — the
  -- app never stores or reads anything on the visitor's own device, so this
  -- table is the only place "uniqueness" is approximated, and only within a
  -- single day.
  visitor_id text,
  seconds integer,
  format text,
  -- Referring hostname only (e.g. "google.com"), not the full referrer URL —
  -- null means direct traffic (typed URL, bookmark, or same-origin nav).
  referrer text,
  created_at timestamptz not null default now()
);

alter table fontane_events add column if not exists referrer text;

-- Coarse, GDPR-safe additions (2026-07-23): each is a single aggregate
-- category, never itself identifying, and none of them are stored anywhere
-- other than on the pageview row they arrived with — see api/track/route.ts.
-- - country: 2-letter code from Vercel's edge geolocation() — the request's
--   IP is used to derive this at the edge and never reaches our own code or
--   storage at all (contrast with visitor_id above, which does see the raw
--   IP for one hash operation before discarding it).
-- - device: "mobile" | "tablet" | "desktop", parsed from User-Agent
--   server-side — the full UA string itself is never stored.
-- - language: 2-letter code taken from the Accept-Language header the
--   browser sends with the request anyway. It was originally read from
--   navigator.language in the browser and sent along; that was changed on
--   2026-07-25 because actively querying the device through a JS API is the
--   consent-requiring kind of access under ePrivacy Art. 5(3), while a
--   header that arrives on its own is not. Same two letters, nothing asked
--   of the device. Only the primary tag is kept — the full header's
--   quality-value ordering is a real fingerprinting surface.
-- - page: which surface the pageview happened on ("editor" | "marketplace" |
--   "marketplace-listing") — lets the marketplace browse→download ratio be
--   computed without adding any new identifying data. Since 2026-07-24
--   'duration' rows reuse this same column for the finer VIEW label they
--   were measured in ("studio:grid", "studio:free", "marketplace", …), one
--   row per visible segment — that's how /anneliese's per-view time is
--   computed, with no extra column and still only a fixed category string.
alter table fontane_events add column if not exists country text;
alter table fontane_events add column if not exists device text;
alter table fontane_events add column if not exists language text;
alter table fontane_events add column if not exists page text;

-- "tool_use" (2026-07-23): one event per completed tool action (a finished
-- stroke, a placed Vector anchor, a Move/Rotate/Scale/Nudge/Assign that
-- actually changed something) — which tool, not what it did. Reuses the
-- existing `format` column (unused for this type) rather than adding a
-- dedicated column, same aggregate-count-only shape as exports-by-format.
-- Since 2026-07-25 tool_use rows also carry `page` (the view the action
-- happened in, same labels duration rows use) — "Vector in Grid" and
-- "Vector in the Editor" are different facts about what the tool is for.

-- Product-usage additions (2026-07-25). Every one of these is still a fixed
-- category or a bucket, never a free value, never anything about content:
-- - session_id: a random id generated per PAGE LOAD and held only in a JS
--   variable (see lib/analytics.ts) — nothing is written to the visitor's
--   device, so the "no consent needed" position is unchanged, and it is
--   strictly less identifying than visitor_id above (which is derived from
--   the IP; this is derived from nothing). It exists so events within one
--   visit can be counted together: did this visit draw anything, did it
--   export, how long until the first stroke. It cannot link two visits, two
--   tabs, or two days — a reload is a new session, by construction.
-- - pointer: "pen" | "touch" | "mouse" | "other" on tool_use rows, from the
--   PointerEvent that produced the action. The one number that says whether
--   pressure/stylus work pays off at all.
-- - bucket: a coarse magnitude, never an exact count. On export rows it is
--   how many glyphs the exported document actually had ("0", "1-5", "6-20",
--   "21-60", "60+") — five buckets can't identify a document, but they do
--   answer "are people making five letters or a typeface". On charset rows
--   it is "on" | "off".
alter table fontane_events add column if not exists session_id text;
alter table fontane_events add column if not exists pointer text;
alter table fontane_events add column if not exists bucket text;

-- Four more event types (2026-07-25), each answering a question the counts
-- above structurally cannot:
-- - undo: one row per undo, `format` = the last tool that reported a use.
--   Raw usage says a tool is reached for; the undo rate says whether it did
--   what the person expected.
-- - charset: a character set toggled on or off in Grid (`format` = set id,
--   `bucket` = on/off) — the most direct evidence of which glyph coverage is
--   actually wanted, rather than which we guessed as the default.
-- - gate: a wall someone hit and could not pass (`format` = which one, e.g.
--   "cloud-code"). Every rejected betacode is a person asking for accounts.
-- - error: a user-visible failure (`format` = where, e.g. "export:otf").
--   Without it a failed export is indistinguishable from a successful one,
--   since the export event fires when the button is pressed.
alter table fontane_events drop constraint if exists fontane_events_type_check;
alter table fontane_events add constraint fontane_events_type_check
  check (type in ('pageview', 'duration', 'export', 'tool_use', 'undo', 'charset', 'gate', 'error'));

-- Retention (2026-07-25). Storage limitation (GDPR Art. 5(1)(e)) is not
-- satisfied by "we only keep harmless things" — a period has to exist and be
-- stated, and until now this table had none and grew forever. Two stages,
-- because the two things on a row age differently:
--
-- 1. visitor_id, after 90 days. It is the only value here derived from the
--    visitor's IP. It is already a salted daily hash that nothing can
--    reverse, but it is the one column with even a theoretical path back to
--    a person, so it is the one with the short clock. Nulling it costs the
--    dashboard nothing: no view reads it (unique-visitor approximation was
--    never built on it), and it stays intact for the 90 days it might.
--
-- 2. the whole row, after 14 months. Long enough for a year-over-year look
--    at a seasonal month, short enough not to be an archive.
--
-- session_id is deliberately NOT on the 90-day clock: it is a random number
-- generated in the visitor's page and never associated with any identifier,
-- by them or by us — there is nothing it could be re-identified through, and
-- keeping it is what lets the funnel on /anneliese still work for older
-- ranges.
create or replace function fontane_events_retention() returns void
language sql security definer set search_path = public as $$
  update fontane_events set visitor_id = null
   where visitor_id is not null and created_at < now() - interval '90 days';
  delete from fontane_events where created_at < now() - interval '14 months';
$$;

-- Run it on a schedule. pg_cron is available on Supabase but has to be
-- enabled per project (Dashboard → Database → Extensions), so this is left
-- commented rather than failing the whole script on a project without it.
-- Enable the extension, then run these two lines once:
--
--   create extension if not exists pg_cron;
--   select cron.schedule('fontane-events-retention', '17 3 * * *',
--                        $$select fontane_events_retention()$$);
--
-- Until that is scheduled, calling select fontane_events_retention(); by
-- hand does the same thing — but an unscheduled retention policy is a
-- promise, not a practice, so schedule it.

-- RLS enabled with NO policies = deny-all for the anon/authenticated roles.
-- The app only ever reads/writes via the service_role key (server-side
-- only, in Vercel's env vars), which bypasses RLS entirely — so nothing
-- else needs a policy added here.
alter table fontane_events enable row level security;

create index if not exists fontane_events_type_idx on fontane_events (type);
-- /anneliese scopes every query to a date range, and the per-session metrics
-- group by session_id within that range.
create index if not exists fontane_events_created_at_idx on fontane_events (created_at);
create index if not exists fontane_events_session_idx on fontane_events (session_id);

-- service_role bypasses RLS but NOT plain SQL privileges — a table created
-- outside Supabase's dashboard SQL editor (e.g. via a direct psql/pg
-- connection, as this one was) doesn't automatically pick up the default
-- grants Supabase normally applies. Without this, every insert/select from
-- the app fails with "permission denied for table fontane_events".
grant select, insert, delete on public.fontane_events to service_role;
grant usage, select on sequence fontane_events_id_seq to service_role;
