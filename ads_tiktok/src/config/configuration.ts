import type { DealRule } from '../deals/rule-engine.service';

export const DEFAULT_MAPPING = {
  'lead_data.full_name': 'NAME',
  'lead_data.email': 'EMAIL[0][VALUE]',
  'lead_data.phone': 'PHONE[0][VALUE]',
  'lead_data.city': 'UF_CRM_CITY',
  'campaign.campaign_name': 'UF_CRM_UTM_CAMPAIGN',
  'campaign.ad_name': 'UF_CRM_AD_NAME',
  'lead_data.ttclid': 'UF_CRM_TTCLID',
};

export const DEFAULT_RULES: DealRule[] = [
  {
    name: 'Lead ưu tiên cao',
    condition: 'lead.contactable == true AND lead.score >= 85',
    action: 'create_deal',
    pipeline_id: '0',
    stage_id: 'NEW',
    probability: 85,
    probability_mode: 'lead_score',
    priority: 'high',
    assign_to: { strategy: 'fixed', users: [1] },
  },
  {
    name: 'Lead đủ điều kiện',
    condition: 'lead.contactable == true AND lead.score >= 70',
    action: 'create_deal',
    pipeline_id: '0',
    stage_id: 'NEW',
    probability: 70,
    probability_mode: 'lead_score',
    priority: 'normal',
    assign_to: { strategy: 'round_robin', users: [1] },
  },
];
