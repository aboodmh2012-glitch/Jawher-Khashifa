export interface OperationalInsight {
  id: string;
  category: 'connectivity' | 'data-quality' | 'incident' | 'task';
  severity: 'info' | 'warning' | 'critical';
  title: string;
  recommendation: string;
  evidence: { resourceType: 'asset' | 'incident' | 'task'; resourceId: string; observedAt?: number };
}
export interface OperationalBrief {
  generatedAt: number;
  provider: 'rules-v1';
  orgId: string;
  totalFindings: number;
  insights: OperationalInsight[];
}
