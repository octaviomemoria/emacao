-- Esquema do app de rastreamento da estratégia. Acesso apenas pelo servidor (service role):
-- RLS ligada e SEM políticas, então as chaves públicas (anon/authenticated) não leem nada.

create table if not exists kv (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists prices (
  ticker text primary key,
  candles jsonb not null,          -- [{date,open,high,low,close,volume}, ...] ajustados
  updated_at timestamptz not null default now()
);

create table if not exists transactions (
  id uuid primary key default gen_random_uuid(),
  date date not null,
  ticker text not null,
  side text not null check (side in ('BUY','SELL')),
  qty numeric not null check (qty > 0),
  price numeric not null check (price > 0),
  fees numeric not null default 0,
  note text,
  created_at timestamptz not null default now()
);
create index if not exists transactions_date_idx on transactions (date);

create table if not exists alerts (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  type text not null,
  ticker text,
  title text not null,
  body text not null,
  read boolean not null default false,
  dedupe text not null unique
);
create index if not exists alerts_created_idx on alerts (created_at desc);

create table if not exists push_subscriptions (
  endpoint text primary key,
  keys jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists job_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  job text not null,
  ok boolean not null,
  message text not null
);

alter table kv enable row level security;
alter table prices enable row level security;
alter table transactions enable row level security;
alter table alerts enable row level security;
alter table push_subscriptions enable row level security;
alter table job_log enable row level security;
