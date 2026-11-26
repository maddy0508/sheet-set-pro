-- What an installed square metre costs the business.
--
-- The existing labour_rate_cents_per_m2 is the price charged to the customer. Profit
-- cannot be reported from a sell rate alone, so the cost basis is a separate, nullable
-- setting: null means "not recorded", and job costing then reports profit as unknown
-- instead of assuming a figure.

alter table public.businesses
  add column if not exists labour_cost_cents_per_m2 integer
  check (labour_cost_cents_per_m2 is null or labour_cost_cents_per_m2 >= 0);

comment on column public.businesses.labour_cost_cents_per_m2 is
  'Internal labour cost per installed m². Null until the operator records it; job costing reports profit as unknown while null.';
