// Alert rules engine (§10). Evaluates each normalized telemetry sample against
// configurable thresholds and raises/clears alerts, de-duplicated per (asset,kind)
// so a sustained condition produces one alert, not a flood.

import type { Asset, Alert, AlertKind, AlertSeverity, Geofence } from '@fusion/shared-types';
import type { Store } from './store.js';
import type { Bus } from './bus.js';
import { envelope } from '@fusion/event-contracts';

interface Rule {
  kind: AlertKind;
  test: (a: Asset) => { hit: boolean; severity: AlertSeverity; message: string };
}

function pointInPolygon(lon: number, lat: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    const intersect = yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

export class AlertEngine {
  /** active[`${assetId}:${kind}`] = alertId, so we clear the right one. */
  private active = new Map<string, string>();

  constructor(private store: Store, private bus: Bus) {}

  private rules(geofences: Geofence[]): Rule[] {
    return [
      {
        kind: 'battery-low',
        test: (a) => {
          const p = a.latest?.battery?.percentage;
          if (p == null) return miss();
          if (p < 10) return { hit: true, severity: 'critical', message: `Battery critical: ${p}%` };
          if (p < 20) return { hit: true, severity: 'high', message: `Battery low: ${p}%` };
          return miss();
        },
      },
      {
        kind: 'gps-degraded',
        test: (a) => {
          const g = a.latest?.gps;
          if (!g) return miss();
          if (g.fix === 'no-fix' || (g.satellites ?? 99) < 6) {
            return { hit: true, severity: 'warning', message: `GPS degraded (fix=${g.fix}, sats=${g.satellites ?? '?'})` };
          }
          return miss();
        },
      },
      {
        kind: 'geofence-warning',
        test: (a) => {
          if (!a.position) return miss();
          for (const f of geofences) {
            if (f.kind !== 'no-fly') continue;
            for (const ring of f.polygon) {
              if (pointInPolygon(a.position.lon, a.position.lat, ring)) {
                return { hit: true, severity: 'high', message: `Entered no-fly zone "${f.name}"` };
              }
            }
          }
          return miss();
        },
      },
    ];
    function miss() { return { hit: false, severity: 'info' as AlertSeverity, message: '' }; }
  }

  evaluate(asset: Asset): void {
    const geofences = [...this.store.geofences.values()];
    for (const rule of this.rules(geofences)) {
      const key = `${asset.id}:${rule.kind}`;
      const { hit, severity, message } = rule.test(asset);
      const activeId = this.active.get(key);
      if (hit && !activeId) {
        const alert = this.store.addAlert({ kind: rule.kind, severity, source: asset.id, sourceName: asset.name, message });
        this.active.set(key, alert.id);
        this.bus.publish(envelope('alert.created', alert));
        this.emitEvent(alert);
      } else if (!hit && activeId) {
        const cleared = this.store.ackAlert(activeId, 'system', 'condition cleared');
        this.active.delete(key);
        if (cleared) { cleared.status = 'resolved'; this.bus.publish(envelope('alert.acknowledged', cleared)); }
      }
    }
  }

  /** Called by the link-state sweep when an asset goes offline. */
  commsLost(asset: Asset): void {
    const key = `${asset.id}:comms-lost`;
    if (asset.link === 'offline' && !this.active.has(key)) {
      const alert = this.store.addAlert({ kind: 'comms-lost', severity: 'high', source: asset.id, sourceName: asset.name, message: `Communication lost with ${asset.name}` });
      this.active.set(key, alert.id);
      this.bus.publish(envelope('alert.created', alert));
      this.emitEvent(alert);
    } else if (asset.link === 'live' && this.active.has(key)) {
      const id = this.active.get(key)!;
      const cleared = this.store.ackAlert(id, 'system', 'link restored');
      this.active.delete(key);
      if (cleared) { cleared.status = 'resolved'; this.bus.publish(envelope('alert.acknowledged', cleared)); }
    }
  }

  private emitEvent(alert: Alert): void {
    const ev = this.store.addEvent('alert.created', alert.message, alert.source, alert.severity);
    this.bus.publish(envelope('event', ev));
  }
}
