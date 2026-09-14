export type CompletionStatus = 'UNREPORTED' | 'NOT_COMPLETED' | 'COMPLETED';

export interface ReadingDay {
  date: string;
  /** Optional per-date source plan; legacy bundled plans use ReadingPlan.planId. */
  planId?: string;
  sourceRows: string[];
  references: string[];
}

export interface ReadingPlan {
  planId: string;
  timezone: string;
  days: ReadingDay[];
  dates: string[];
  uniqueReferences: string[];
}

export type ContentGateStatus =
  | 'C_PENDING_ACCESS'
  | 'C_TECHNICAL_PROBE'
  | 'C_READY'
  | 'C_NOT_AVAILABLE';

export interface ContentGateResult {
  status: ContentGateStatus;
  reason: string;
  evidenceRefs: string[];
}
