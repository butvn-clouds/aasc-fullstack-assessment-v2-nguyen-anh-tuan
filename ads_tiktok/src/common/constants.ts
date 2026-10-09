export const QUEUES = {
  LEAD_PROCESS: 'lead-process',
  BITRIX_SYNC: 'bitrix-sync',
  DEAD_LETTER: 'dead-letter',
  REPORTS: 'report-delivery',
} as const;

export const CONFIG_KEYS = {
  MAPPING: 'field_mapping',
  RULES: 'deal_rules',
  COSTS: 'campaign_costs',
} as const;

export const JOB_OPTIONS = {
  attempts: 5,
  backoff: { type: 'exponential', delay: 2000 },
  removeOnComplete: { age: 3600, count: 1000 },
  removeOnFail: false,
} as const;
