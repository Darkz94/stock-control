create schema stock_private;
revoke all on schema stock_private from public;
grant usage on schema stock_private to authenticated;

create table stock_private.members (
  email text primary key check (email = lower(email)),
  role text not null check (role in ('owner', 'stock'))
);

create table stock_private.state (
  singleton boolean primary key default true check (singleton),
  version bigint not null default 0,
  counts jsonb not null,
  orders jsonb not null default '{"tickets":[],"nextTicket":1}',
  settings jsonb not null default '{"company":"Stock Control","businessWhatsApp":"","lowThreshold":2}'
);
insert into stock_private.state (counts) values (
  '{"two-stroke-500ml":0,"two-stroke-20l":0,"nylon-line":0,"pine-gel-5l":0,"pine-gel-20l":0,"non-selective-20l":0,"non-selective-1l":0,"selective-20l":0,"selective-5l":0,"bleach-5l":0,"toilet-paper":0,"black-bags":0,"rake":0,"broom":0,"mop":0,"broom-sticks":0}'
);

create table stock_private.movements (
  sequence_id bigint generated always as identity primary key,
  at timestamptz not null default statement_timestamp(),
  actor uuid not null,
  actor_role text not null,
  product_id text not null,
  change integer not null,
  kind text not null,
  reason text not null,
  ticket_id text
);
alter table stock_private.members enable row level security;
alter table stock_private.state enable row level security;
alter table stock_private.movements enable row level security;

create function stock_private.member_role() returns text
language sql stable security definer set search_path = '' as $$
  select m.role from stock_private.members m
  join auth.users u on lower(u.email) = m.email
  where u.id = auth.uid() and u.email_confirmed_at is not null;
$$;

create function stock_private.read_state() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  access_role text := stock_private.member_role();
  shared stock_private.state;
  history jsonb;
begin
  if access_role is null then raise exception 'This account has no Stock Control access' using errcode = '42501'; end if;
  select * into strict shared from stock_private.state;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', m.sequence_id, 'at', m.at, 'actor', m.actor_role, 'productId', m.product_id,
    'change', m.change, 'kind', m.kind,
    'reason', case when access_role = 'stock' and m.ticket_id is not null then 'Order collected' else m.reason end,
    'ticketId', case when access_role = 'owner' then m.ticket_id end
  ) order by m.sequence_id desc), '[]'::jsonb) into history from stock_private.movements m;
  return jsonb_build_object(
    'version', shared.version, 'role', access_role, 'counts', shared.counts, 'movements', history,
    'orders', case when access_role = 'owner' then shared.orders end,
    'settings', case when access_role = 'owner' then shared.settings else shared.settings - 'businessWhatsApp' end
  );
end;
$$;

create function stock_private.write_state(expected_version bigint, stock_changes jsonb, order_data jsonb, preferences jsonb)
returns bigint language plpgsql security definer set search_path = '' as $$
declare
  access_role text := stock_private.member_role();
  shared stock_private.state;
  item jsonb;
  item_id text;
  delta integer;
  balance bigint;
  movement_kind text;
  movement_reason text;
  ticket text;
begin
  if access_role is null then raise exception 'This account has no Stock Control access' using errcode = '42501'; end if;
  if access_role = 'stock' and (order_data is not null or preferences is not null) then
    raise exception 'Order and settings access is restricted' using errcode = '42501';
  end if;
  if stock_changes is null or jsonb_typeof(stock_changes) <> 'array' or jsonb_array_length(stock_changes) > 16 then
    raise exception 'Invalid stock movements';
  end if;
  select * into strict shared from stock_private.state for update;
  if expected_version is distinct from shared.version then
    raise exception 'Stock Control changed on another device. Refresh and retry.' using errcode = '40001';
  end if;
  for item in select value from jsonb_array_elements(stock_changes) loop
    item_id := item->>'productId';
    delta := (item->>'change')::integer;
    movement_kind := item->>'kind';
    movement_reason := btrim(item->>'reason');
    ticket := item->>'ticketId';
    if item_id is null or not (shared.counts ? item_id) or delta is null
      or movement_kind is null
      or movement_kind not in ('Received', 'Written off', 'Stock count', 'Conversion out', 'Conversion in', 'Order collected')
      or (access_role = 'stock' and (movement_kind not in ('Received', 'Written off', 'Stock count') or ticket is not null))
      or movement_reason is null or length(movement_reason) not between 1 and 220 then
      raise exception 'Invalid stock movement';
    end if;
    balance := (shared.counts->>item_id)::bigint + delta;
    if balance not between 0 and 2147483647 then raise exception 'Stock balance outside permitted range'; end if;
    shared.counts := jsonb_set(shared.counts, array[item_id], to_jsonb(balance));
    insert into stock_private.movements (actor, actor_role, product_id, change, kind, reason, ticket_id)
      values (auth.uid(), access_role, item_id, delta, movement_kind, movement_reason, ticket);
  end loop;
  update stock_private.state set counts = shared.counts, version = shared.version + 1,
    orders = coalesce(order_data, shared.orders), settings = coalesce(preferences, shared.settings);
  return shared.version + 1;
end;
$$;

create function public.stock_control_read() returns jsonb
language sql stable security invoker set search_path = '' as $$
  select stock_private.read_state();
$$;
create function public.stock_control_write(expected_version bigint, stock_changes jsonb, order_data jsonb, preferences jsonb)
returns bigint language sql security invoker set search_path = '' as $$
  select stock_private.write_state(expected_version, stock_changes, order_data, preferences);
$$;
revoke execute on all functions in schema stock_private from public, anon, authenticated;
revoke execute on function public.stock_control_read(), public.stock_control_write(bigint, jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function stock_private.read_state(), stock_private.write_state(bigint, jsonb, jsonb, jsonb),
  public.stock_control_read(), public.stock_control_write(bigint, jsonb, jsonb, jsonb) to authenticated;
