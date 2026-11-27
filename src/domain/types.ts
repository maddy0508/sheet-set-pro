export type Id = string;

export type SourceType = 'SYNTHETIC' | 'TEST' | 'REAL';

export type MeasurementGrade = 'ESTIMATE_GRADE' | 'ORDER_GRADE';

export type EvidenceKind =
  | 'manual'
  | 'plan'
  | 'photograph'
  | 'aerial'
  | 'lidar'
  | 'ar_depth'
  | 'ai_assisted';

export type FlashingKind = 'ridge' | 'hip' | 'valley' | 'barge' | 'apron' | 'box_gutter' | 'eave';

export type PlaneGeometry = {
  ref: string;
  /** Plan position of the plane's lower-left corner, in millimetres. */
  xMm: number;
  yMm: number;
  /** Width across the slope. */
  widthMm: number;
  /** Length up the slope, measured along the roof surface. */
  lengthMm: number;
  pitchMicrodeg: number;
  /** Direction water runs off; the eave is the low edge. Defaults to south. */
  fall?: 'north' | 'south' | 'east' | 'west';
  /** Ridge length across the slope. Shorter than the eave width makes a hip end. */
  ridgeWidthMm?: number | null;
};

export type BomCategory = 'sheet' | 'flashing' | 'fastener' | 'accessory' | 'consumable';

export type BomLine = {
  key: string;
  description: string;
  category: BomCategory;
  quantityMicro: number;
  unit: string;
  unitPriceCents: number;
  isPlaceholder: boolean;
  note?: string;
};

export type ValidationSeverity = 'blocking' | 'warning' | 'info';

export type ValidationIssue = {
  ruleId: string;
  severity: ValidationSeverity;
  message: string;
  subjectRef?: string;
};
