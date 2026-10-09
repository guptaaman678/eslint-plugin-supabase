-- Created after the opt-in: each table holds only the grants below.

-- No grant at all.
create table public.orders (
  id bigint generated always as identity primary key,
  total numeric not null
);

-- Writes without select.
create table public.messages (
  id bigint generated always as identity primary key,
  body text not null
);

grant insert, update, delete on public.messages to authenticated;

-- Select and insert, no update.
create table public.scores (
  id bigint generated always as identity primary key,
  points integer not null
);

grant select, insert on public.scores to authenticated;

grant select, insert, update, delete on public.scores to service_role;

-- Everything through PUBLIC.
create table public.audit_log (
  id bigint generated always as identity primary key,
  entry text not null
);

grant select, insert, update, delete on public.audit_log to public;

-- Column grants count as held.
create table public.notes (
  id bigint generated always as identity primary key,
  body text not null
);

grant select (id, body), update (body) on public.notes to authenticated;

-- Select for anon only.
create table public.feeds (
  id bigint generated always as identity primary key,
  title text not null
);

grant select on public.feeds to anon;

-- A view with no grant.
create view public.order_totals as select id, total from public.orders;

-- Another schema.
create schema app;

create table app.orders (
  id bigint generated always as identity primary key,
  total numeric not null
);

grant usage on schema app to authenticated;

grant select on app.orders to authenticated;

-- Granted, then revoked.
create table public.drafts (
  id bigint generated always as identity primary key,
  body text not null
);

grant select, insert on public.drafts to authenticated;

revoke insert on public.drafts from authenticated;
