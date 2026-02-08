create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique not null,
  full_name text,
  role text not null check (role in ('admin', 'cashier')),
  created_at timestamptz not null default now()
);

create table if not exists public.items (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  price numeric(10, 2) not null default 0,
  cost_price numeric(10, 2) not null default 0,
  stock_qty integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.items add column if not exists stock_qty integer not null default 0;
alter table public.items add column if not exists cost_price numeric(10, 2) not null default 0;

create table if not exists public.services (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  price numeric(10, 2) not null default 0,
  duration_min integer not null default 30,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.bills (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  created_by uuid not null references public.profiles(id),
  total numeric(10, 2) not null default 0,
  discount numeric(10, 2) not null default 0
);

alter table public.bills add column if not exists discount numeric(10, 2) not null default 0;

create table if not exists public.bill_lines (
  id uuid primary key default gen_random_uuid(),
  bill_id uuid not null references public.bills(id) on delete cascade,
  line_type text not null check (line_type in ('item', 'service')),
  ref_id uuid not null,
  name text not null,
  qty integer not null default 1,
  unit_price numeric(10, 2) not null default 0,
  cost_price numeric(10, 2) not null default 0,
  total numeric(10, 2) not null default 0
);

alter table public.bill_lines add column if not exists cost_price numeric(10, 2) not null default 0;

create or replace function public.has_any_role(roles text[])
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = any(roles)
  );
$$;

alter table public.profiles enable row level security;
alter table public.items enable row level security;
alter table public.services enable row level security;
alter table public.bills enable row level security;
alter table public.bill_lines enable row level security;

create policy "profiles read"
  on public.profiles for select
  using (auth.role() = 'authenticated');

create policy "profiles admin update"
  on public.profiles for update
  using (public.has_any_role(array['admin']))
  with check (public.has_any_role(array['admin']));

create policy "items read"
  on public.items for select
  using (auth.role() = 'authenticated');

create policy "items write admin"
  on public.items for insert
  with check (public.has_any_role(array['admin']));

create policy "items update admin"
  on public.items for update
  using (public.has_any_role(array['admin']))
  with check (public.has_any_role(array['admin']));

create policy "items delete admin"
  on public.items for delete
  using (public.has_any_role(array['admin']));

create or replace function public.decrement_item_stock(item_id uuid, qty integer)
returns boolean
language plpgsql
security definer
as $$
declare
  updated_count integer;
begin
  if qty <= 0 then
    return false;
  end if;

  update public.items
    set stock_qty = stock_qty - qty
  where id = item_id
    and stock_qty >= qty;

  get diagnostics updated_count = row_count;
  return updated_count = 1;
end;
$$;

grant execute on function public.decrement_item_stock(uuid, integer) to authenticated;

create policy "services read"
  on public.services for select
  using (auth.role() = 'authenticated');

create policy "services write admin"
  on public.services for insert
  with check (public.has_any_role(array['admin']));

create policy "services update admin"
  on public.services for update
  using (public.has_any_role(array['admin']))
  with check (public.has_any_role(array['admin']));

create policy "services delete admin"
  on public.services for delete
  using (public.has_any_role(array['admin']));

create policy "bills read"
  on public.bills for select
  using (auth.role() = 'authenticated');

create policy "bills insert"
  on public.bills for insert
  with check (public.has_any_role(array['admin', 'cashier']));

create policy "bill_lines read"
  on public.bill_lines for select
  using (auth.role() = 'authenticated');

create policy "bill_lines insert"
  on public.bill_lines for insert
  with check (public.has_any_role(array['admin', 'cashier']));
