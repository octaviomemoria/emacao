-- Pregão simulado: ordens digitadas pelo usuário e fills executados pela rotina.
-- Estado do pregão (caixa, posições, curva) fica na tabela kv, chave "pregao".
-- Acesso apenas pelo servidor (service role); RLS ligada e sem políticas, como nas demais tabelas.

create table if not exists pregao_orders (
  id uuid primary key,
  created_at timestamptz not null,
  created_date date not null,              -- data (BRT) da digitação; a sessão é o pregão seguinte
  ticker text not null,
  side text not null check (side in ('BUY','SELL')),
  type text not null check (type in ('MARKET','LIMIT','STOP')),
  qty numeric not null check (qty > 0),
  limit_price numeric check (limit_price is null or limit_price > 0),
  stop_price numeric check (stop_price is null or stop_price > 0),
  est_price numeric,                       -- preço usado para reservar caixa/quantidade enquanto a ordem está aberta
  status text not null check (status in ('OPEN','EXECUTED','PARTIAL','NOT_EXECUTED','BLOCKED','CANCELLED')),
  filled_qty numeric not null default 0,
  avg_price numeric not null default 0,
  fees numeric not null default 0,
  session_date date,                       -- pregão em que a ordem foi processada
  reason text,
  gap numeric
);
create index if not exists pregao_orders_status_idx on pregao_orders (status, created_date);

create table if not exists pregao_fills (
  id uuid primary key,
  order_id uuid not null references pregao_orders(id) on delete cascade,
  date date not null,
  ticker text not null,
  side text not null check (side in ('BUY','SELL')),
  qty numeric not null check (qty > 0),
  price numeric not null check (price > 0),
  fees numeric not null default 0
);
create index if not exists pregao_fills_date_idx on pregao_fills (date);

alter table pregao_orders enable row level security;
alter table pregao_fills enable row level security;
