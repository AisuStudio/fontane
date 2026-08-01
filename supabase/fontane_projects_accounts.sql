-- Moves fontane_projects from the shared-betacode/service-role-only setup
-- (see the original header comment in fontane_projects.sql) to real
-- per-user ownership via Supabase Auth. Run this once in Fontane.Studio's
-- own Supabase project (SQL Editor), after fontane_projects.sql.
--
-- Safe to run even with existing rows IF the table is empty (confirmed via
-- a direct read-only query before writing this: 0 rows as of this
-- migration) — `set not null` would fail on a populated table with no
-- user_id backfill plan, which isn't needed here.

alter table fontane_projects add column if not exists user_id uuid references auth.users(id) on delete cascade;
alter table fontane_projects alter column user_id set not null;

-- Replaces the old "RLS enabled, no policies, service_role only" model —
-- api/projects/* now query as the signed-in user (see
-- src/lib/supabaseServer.ts), so these policies are the actual security
-- boundary, not just an app-level check.
create policy "own projects select" on fontane_projects for select to authenticated using (auth.uid() = user_id);
create policy "own projects insert" on fontane_projects for insert to authenticated with check (auth.uid() = user_id);
create policy "own projects update" on fontane_projects for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own projects delete" on fontane_projects for delete to authenticated using (auth.uid() = user_id);

create index if not exists fontane_projects_user_idx on fontane_projects (user_id, updated_at desc);

-- service_role keeps its existing grant (harmless, and other server-side
-- tooling may still want it) — this just adds what `authenticated` now
-- needs to run its own RLS-scoped queries.
grant select, insert, update, delete on public.fontane_projects to authenticated;
