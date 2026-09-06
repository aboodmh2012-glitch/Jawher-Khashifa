// @fusion/authorization — a single PolicyEngine instead of RBAC if-statements
// scattered across routes. Authorization = role capability + tenant scoping.
//
//   policy.can(actor, 'feature.update', { organizationId, operationId, resourceId })
//
// Every capability check goes through here, so policy is auditable and testable
// in one place (§C3). Tenant isolation is part of the decision (§C2): only a
// platform-admin may cross organizations.

import type { Role } from '@fusion/shared-types';

export interface Actor {
  userId: string;
  role: Role;
  organizationId: string;
}

export interface PolicyContext {
  organizationId?: string;
  operationId?: string;
  resourceId?: string;
}

export interface PolicyDecision {
  allow: boolean;
  reason?: string;
}

/** Role ranking for capability comparisons. */
export const ROLE_RANK: Record<Role, number> = {
  viewer: 0, 'field-user': 1, analyst: 2, operator: 3, 'ops-supervisor': 4, 'org-admin': 5, 'platform-admin': 6,
};
export function atLeast(role: Role, min: Role): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[min];
}

/** The capability registry: action → minimum role required. */
export const ACTION_MIN_ROLE = {
  // reads
  'organization.read': 'viewer',
  'asset.read': 'viewer',
  'telemetry.read': 'viewer',
  'track.read': 'viewer',
  'incident.read': 'viewer',
  'task.read': 'viewer',
  'alert.read': 'viewer',
  'feature.read': 'viewer',
  'operation.read': 'viewer',
  'picture.read': 'viewer',
  'schema.read': 'viewer',
  // analyst
  'observation.read': 'analyst',
  'raw.read': 'analyst',
  'quarantine.read': 'analyst',
  // operator writes
  'incident.create': 'operator',
  'incident.update': 'operator',
  'task.create': 'operator',
  'task.update': 'operator',
  'alert.ack': 'operator',
  'feature.create': 'operator',
  'feature.update': 'operator',
  'feature.delete': 'operator',
  // supervisor+
  'raw.reprocess': 'ops-supervisor',
  'audit.read': 'ops-supervisor',
} as const satisfies Record<string, Role>;

export type Action = keyof typeof ACTION_MIN_ROLE;

export class PolicyEngine {
  /** Decide whether `actor` may perform `action` in `ctx`. */
  can(actor: Actor, action: Action, ctx: PolicyContext = {}): PolicyDecision {
    const min = ACTION_MIN_ROLE[action];
    if (!min) return { allow: false, reason: `unknown action '${action}'` };
    if (!atLeast(actor.role, min)) return { allow: false, reason: `role '${actor.role}' below required '${min}'` };
    // tenant isolation: only platform-admin may act across organizations
    if (ctx.organizationId && ctx.organizationId !== actor.organizationId && actor.role !== 'platform-admin') {
      return { allow: false, reason: 'cross-tenant access denied' };
    }
    return { allow: true };
  }
}

export const policy = new PolicyEngine();
