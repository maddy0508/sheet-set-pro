-- Sheet Set Pro — immutable snapshots of issued commercial documents.
--
-- A PDF rebuilt from the business, customer and job records shows whatever those records
-- say today, so editing a customer's address silently rewrites an invoice that was issued
-- last month. The snapshot removes that: at issue the document captures everything the
-- customer sees, and reprints render from the snapshot.
--
-- Existing issued documents keep `snapshot` null. Their historical values cannot be
-- recovered — the records they were built from have moved on — and writing today's values
-- into the column would create a snapshot that never existed at issue. Those documents are
-- labelled as legacy in the application and continue to render from current records until
-- they are superseded. No historical row is rewritten by this migration.

alter table public.quotes
  add column if not exists snapshot jsonb;

alter table public.quotes
  add constraint quotes_snapshot_is_object
  check (snapshot is null or jsonb_typeof(snapshot) = 'object');

alter table public.invoices
  add column if not exists snapshot jsonb;

alter table public.invoices
  add constraint invoices_snapshot_is_object
  check (snapshot is null or jsonb_typeof(snapshot) = 'object');

comment on column public.quotes.snapshot is
  'Customer-visible content captured at issue. Null on documents issued before snapshots existed.';
comment on column public.invoices.snapshot is
  'Customer-visible content captured at issue. Null on documents issued before snapshots existed.';

-- The snapshot joins the frozen content of an issued document: it cannot be added,
-- replaced or removed after issue.

create or replace function public.protect_quote_history()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    if old.issued_at is not null then
      raise exception 'Quote % was issued and cannot be deleted.', old.number using errcode = 'P0001';
    end if;
    return old;
  end if;

  if old.issued_at is not null then
    if new.lines is distinct from old.lines
       or new.totals is distinct from old.totals
       or new.number is distinct from old.number
       or new.fingerprint is distinct from old.fingerprint
       or new.snapshot is distinct from old.snapshot
       or new.issued_at is distinct from old.issued_at
       or new.gst_applied is distinct from old.gst_applied
       or new.gst_rate_bp is distinct from old.gst_rate_bp
       or new.revision is distinct from old.revision
       or new.job_id is distinct from old.job_id
       or new.business_id is distinct from old.business_id
       or new.created_at is distinct from old.created_at then
      raise exception 'Quote % was issued; only its acceptance status may change.', old.number
        using errcode = 'P0001';
    end if;
  end if;

  return new;
end;
$$;

create or replace function public.protect_invoice_history()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Invoices are never deleted; void them instead.' using errcode = 'P0001';
  end if;

  if old.issued_at is not null then
    if new.status is distinct from old.status and not (old.status = 'issued' and new.status = 'voided') then
      raise exception 'Invoice % was issued; the only permitted change is voiding it.', old.number
        using errcode = 'P0001';
    end if;
    if new.status = old.status and new.void_reason is distinct from old.void_reason then
      raise exception 'Invoice % was issued; its content cannot change.', old.number using errcode = 'P0001';
    end if;
    if new.lines is distinct from old.lines
       or new.totals is distinct from old.totals
       or new.number is distinct from old.number
       or new.fingerprint is distinct from old.fingerprint
       or new.snapshot is distinct from old.snapshot
       or new.issued_at is distinct from old.issued_at
       or new.gst_registered_snapshot is distinct from old.gst_registered_snapshot
       or new.gst_rate_bp is distinct from old.gst_rate_bp
       or new.job_id is distinct from old.job_id
       or new.business_id is distinct from old.business_id
       or new.created_at is distinct from old.created_at then
      raise exception 'Invoice % was issued; its content cannot change.', old.number using errcode = 'P0001';
    end if;
  end if;

  return new;
end;
$$;
