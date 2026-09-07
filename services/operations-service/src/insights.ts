import type { OperationalBrief, OperationalInsight } from '@fusion/shared-types';
import type { Store } from './store.js';

// Narrow, deterministic decision support. No generated commands or device writes.
export function operationalBrief(store: Store, now = Date.now()): OperationalBrief {
  const insights: OperationalInsight[] = [];
  for (const asset of store.assets.values()) {
    const age = asset.lastSeen === undefined ? Infinity : now - asset.lastSeen;
    if (age >= 5000 || asset.link === 'offline') insights.push({
      id: `link:${asset.id}`, category: 'connectivity', severity: age >= 20000 || asset.link === 'offline' ? 'critical' : 'warning',
      title: `${asset.name}: ${age === Infinity ? 'no telemetry received' : 'telemetry is stale'}`,
      recommendation: 'Verify the connection and confirm the current status before relying on this position.',
      evidence: { resourceType: 'asset', resourceId: asset.id, observedAt: asset.lastSeen },
    });
    else if (asset.latest && now - asset.latest.timestamp >= 20000) insights.push({
      id: `source-age:${asset.id}`, category: 'data-quality', severity: 'warning', title: `${asset.name}: delayed source timestamp`,
      recommendation: 'Check the device clock and transport delay; recent receipt does not guarantee a current measurement.',
      evidence: { resourceType: 'asset', resourceId: asset.id, observedAt: asset.latest.timestamp },
    });
  }
  for (const incident of store.incidents.values()) if (!['closed','resolved'].includes(incident.status) && incident.severity === 'critical') {
    insights.push({ id: `incident:${incident.id}`, category: 'incident', severity: 'critical', title: incident.title,
      recommendation: 'Review the incident status, assigned team and latest reports.',
      evidence: { resourceType: 'incident', resourceId: incident.id, observedAt: incident.updatedAt } });
  }
  for (const task of store.tasks.values()) if (task.deadline !== undefined && task.deadline < now && !['completed','cancelled'].includes(task.status)) {
    insights.push({ id: `task:${task.id}`, category: 'task', severity: 'warning', title: `${task.name}: overdue`,
      recommendation: 'Contact the responsible team and update the deadline or task status.',
      evidence: { resourceType: 'task', resourceId: task.id, observedAt: task.deadline } });
  }
  const rank = { critical: 0, warning: 1, info: 2 };
  insights.sort((a, b) => rank[a.severity] - rank[b.severity] || a.id.localeCompare(b.id));
  return { generatedAt: now, provider: 'rules-v1', orgId: store.orgId, totalFindings: insights.length, insights: insights.slice(0,100) };
}
