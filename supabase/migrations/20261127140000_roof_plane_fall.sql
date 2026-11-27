-- Roof planes gain a fall direction and an optional ridge width.
--
-- Without a fall direction every plane could only rise "up the page", so a gable, a valley
-- or a hip end could not be captured, and the 3D model could not be derived from the
-- measurements. `fall` names the direction water runs off, which fixes the eave as the low
-- edge; `ridge_width_mm` lets a plane narrow towards the ridge, which is what a hip end is.
--
-- Existing rows default to 'south', matching the drafting convention they were captured
-- under (the eave at the bottom of the plan). No row is rewritten.

alter table public.roof_planes
  add column fall text not null default 'south'
    check (fall in ('north', 'south', 'east', 'west')),
  add column ridge_width_mm integer
    check (ridge_width_mm is null or ridge_width_mm >= 0);

comment on column public.roof_planes.fall is
  'Direction water runs off the plane; the eave is the low edge.';
comment on column public.roof_planes.ridge_width_mm is
  'Ridge length across the slope. NULL means the ridge is as wide as the eave. Shorter than width_mm is a hip end.';
