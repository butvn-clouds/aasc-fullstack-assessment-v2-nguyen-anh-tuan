export interface SyncResult {
  conflicts?: number;
  pulledDown?: number;
  totalRows: number;
  created: number;
  updated: number;
  skipped: number;
  errors: number;
  errorDetails: Array<{ rowNumber: number; message: string }>;
  startedAt: string;
  finishedAt: string;
}

export interface ReverseSyncResult {
  created: number;
  updated: number;
  errors: number;
  errorDetails: Array<{ leadId: string; rowNumber?: number; message: string }>;
  totalChecked: number;
  pulledDown: number;
  conflicts: number;
  skipped: number;
  startedAt: string;
  finishedAt: string;
}
