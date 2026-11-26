-- Sheet Set Pro — history protection.
-- Rules that the database enforces regardless of what the client sends: issued
-- documents are frozen, measurements can only be superseded, and money records are
-- append-only. The application already behaves this way; the database now guarantees it.

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

create trigger quotes_protect_history
  before update or delete on public.quotes
  for each row execute function public.protect_quote_history();

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

create trigger invoices_protect_history
  before update or delete on public.invoices
  for each row execute function public.protect_invoice_history();

create or replace function public.protect_measurement_history()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Measurements are superseded, never deleted.' using errcode = 'P0001';
  end if;

  if new.kind is distinct from old.kind
     or new.label is distinct from old.label
     or new.value_mm is distinct from old.value_mm
     or new.tolerance_mm is distinct from old.tolerance_mm
     or new.grade is distinct from old.grade
     or new.evidence_id is distinct from old.evidence_id
     or new.job_id is distinct from old.job_id
     or new.business_id is distinct from old.business_id
     or new.created_at is distinct from old.created_at then
    raise exception 'A measurement is evidence: supersede it and record a new one.' using errcode = 'P0001';
  end if;

  if old.is_active = false and new.is_active = true then
    raise exception 'A superseded measurement cannot be reactivated.' using errcode = 'P0001';
  end if;

  return new;
end;
$$;

create trigger measurements_protect_history
  before update or delete on public.measurements
  for each row execute function public.protect_measurement_history();

create or replace function public.protect_evidence_history()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Measurement evidence is never deleted.' using errcode = 'P0001';
  end if;

  if new.source_kind is distinct from old.source_kind
     or new.accuracy_claim_mm is distinct from old.accuracy_claim_mm
     or new.accuracy_basis is distinct from old.accuracy_basis
     or new.job_id is distinct from old.job_id
     or new.business_id is distinct from old.business_id
     or new.created_at is distinct from old.created_at then
    raise exception 'Evidence records its source permanently; add a new evidence record instead.'
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

create trigger evidence_protect_history
  before update or delete on public.measurement_evidence
  for each row execute function public.protect_evidence_history();

create or replace function public.reject_history_change()
returns trigger
language plpgsql
as $$
begin
  raise exception '%', tg_argv[0] using errcode = 'P0001';
end;
$$;

create trigger estimates_append_only
  before update or delete on public.estimates
  for each row execute function public.reject_history_change('Estimates are immutable; save a new revision.');

create trigger payments_append_only
  before update or delete on public.payments
  for each row execute function public.reject_history_change('Payments are append-only; record a correction as a new entry.');

create trigger payment_allocations_append_only
  before update or delete on public.payment_allocations
  for each row execute function public.reject_history_change('Payment allocations are append-only.');

create trigger calc_snapshots_append_only
  before update or delete on public.calc_snapshots
  for each row execute function public.reject_history_change('Calculation snapshots are immutable.');

create trigger activity_events_append_only
  before update or delete on public.activity_events
  for each row execute function public.reject_history_change('The activity log is append-only.');
