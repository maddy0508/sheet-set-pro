import type { JobCosting } from '@/lib/costing';
import type { CatalogueProfile, Evidence, Flashing, Job, Measurement, Plane } from '@/data/types';
import type { JobComputation } from '@/lib/jobCalc';

export type JobTabProps = {
  job: Job;
  planes: Plane[];
  flashings: Flashing[];
  evidence: Evidence[];
  measurements: Measurement[];
  profile: CatalogueProfile | null;
  computation: JobComputation;
  costing: JobCosting;
};
