-- Sheet Set Pro — the single workspace row and the development catalogue.
-- Business identity details are deliberately left null: the operator confirms them in
-- Settings. Catalogue entries are SYNTHETIC and unverified; the schema refuses to mark
-- them VERIFIED until they are ENTERED from a real manufacturer source.

insert into public.businesses (id, display_name, gst_registered, gst_rate_bp, gst_rate_confirmed)
values ('00000000-0000-4000-8000-000000000001', 'Mitchell''s Metal Roofing', null, 1000, false)
on conflict (id) do nothing;

insert into public.catalogue_profiles (
  id, business_id, manufacturer, name, material, thickness_mm, coating,
  effective_cover_mm, min_pitch_deg, max_length_mm, lap_longitudinal_mm, lap_transverse_mm,
  sheet_price_cents_per_m, fixing_per_sheet, flashing_girth_mm,
  verification_state, price_basis, source_note, revision, effective_from
)
values
  (
    'cat-syn-1', '00000000-0000-4000-8000-000000000001',
    'SYNTHETIC — example manufacturer', 'Synthetic Corrugated 0.42', 'Steel (synthetic example)',
    0.42, 'Synthetic coating', 762, 5, 8200, 0, 150, 2350, 12, 200,
    'PLACEHOLDER', 'SYNTHETIC',
    'SYNTHETIC DEVELOPMENT DATA — not a manufacturer specification.', 'dev-1', '2026-01-01'
  ),
  (
    'cat-syn-2', '00000000-0000-4000-8000-000000000001',
    'SYNTHETIC — example manufacturer', 'Synthetic Standing Seam 0.55', 'Steel (synthetic example)',
    0.55, 'Synthetic coating', 470, 3, 12000, 0, 150, 3950, 8, 250,
    'PLACEHOLDER', 'SYNTHETIC',
    'SYNTHETIC DEVELOPMENT DATA — not a manufacturer specification.', 'dev-1', '2026-01-01'
  )
on conflict (id) do nothing;
