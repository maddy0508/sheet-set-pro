-- Sheet Set Pro — allocation integrity.
--
-- The browser checks these rules so the operator gets an immediate answer. That check
-- is a convenience, not the boundary: two tabs, two operators or a replayed request can
-- each pass it and still over-allocate between them. The database decides.
--
-- The guard runs before every insert, locks the payment and then the invoice, and only
-- after holding both locks totals the allocations already recorded. Lock order is always
-- payment then invoice, so concurrent allocations queue instead of deadlocking. A waiting
-- transaction re-reads its totals once it owns the lock, and under READ COMMITTED that
-- read includes whatever the transaction ahead of it committed, so the second request is
-- measured against the first. A client running REPEATABLE READ fails with "could not
-- serialize access due to concurrent update" — refused, never over-allocated.
--
-- Allocations are append-only (see 20261126091000_protection.sql), so an over-allocation
-- cannot be created by editing an existing row either.

create or replace function public.guard_allocation()
returns trigger
language plpgsql
as $$
declare
  v_payment public.payments%rowtype;
  v_invoice public.invoices%rowtype;
  v_allocated bigint;
  v_invoice_total bigint;
begin
  if new.amount_cents is null or new.amount_cents <= 0 then
    raise exception 'An allocation must be a positive whole number of cents.' using errcode = 'P0001';
  end if;

  select * into v_payment from public.payments where id = new.payment_id for update;
  if not found then
    raise exception 'Payment % does not exist.', new.payment_id using errcode = 'P0002';
  end if;

  select * into v_invoice from public.invoices where id = new.invoice_id for update;
  if not found then
    raise exception 'Invoice % does not exist.', new.invoice_id using errcode = 'P0002';
  end if;

  if v_payment.business_id <> new.business_id or v_invoice.business_id <> new.business_id then
    raise exception 'A payment and its invoice must belong to the same business.' using errcode = 'P0001';
  end if;

  if v_payment.job_id <> v_invoice.job_id then
    raise exception 'A payment can only be allocated to an invoice on the same job.' using errcode = 'P0001';
  end if;

  if v_invoice.status <> 'issued' then
    raise exception 'Invoice % is %; only an issued invoice can receive an allocation.',
      v_invoice.number, v_invoice.status using errcode = 'P0001';
  end if;

  select coalesce(sum(a.amount_cents), 0) into v_allocated
  from public.payment_allocations a
  where a.payment_id = new.payment_id;

  if v_allocated + new.amount_cents > v_payment.amount_cents then
    raise exception 'Allocation of % cents exceeds the % cents unallocated on payment %.',
      new.amount_cents, v_payment.amount_cents - v_allocated, v_payment.id using errcode = 'P0001';
  end if;

  v_invoice_total := coalesce((v_invoice.totals ->> 'totalCents')::bigint, 0);

  select coalesce(sum(a.amount_cents), 0) into v_allocated
  from public.payment_allocations a
  where a.invoice_id = new.invoice_id;

  if v_allocated + new.amount_cents > v_invoice_total then
    raise exception 'Allocation of % cents exceeds the % cents outstanding on invoice %.',
      new.amount_cents, v_invoice_total - v_allocated, v_invoice.number using errcode = 'P0001';
  end if;

  return new;
end;
$$;

create trigger payment_allocations_guard
  before insert on public.payment_allocations
  for each row execute function public.guard_allocation();

revoke all on function public.guard_allocation() from public;
