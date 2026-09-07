import type { Capability, PlatformApp, PlatformContext } from '@fusion/platform-contracts';

export class AppRegistry {
  private readonly apps = new Map<string, PlatformApp>();
  private readonly active = new Set<string>();

  register(app: PlatformApp): void {
    const id = app.manifest.id;
    if (this.apps.has(id)) throw new Error(`app already registered: ${id}`);
    this.apps.set(id, app);
  }

  list(): PlatformApp[] {
    return [...this.apps.values()];
  }

  validateCapabilities(appId: string, available: Set<Capability>): string[] {
    const app = this.apps.get(appId);
    if (!app) return [`unknown app: ${appId}`];
    return (app.manifest.requiredCapabilities ?? [])
      .filter((capability) => !available.has(capability))
      .map((capability) => `missing capability: ${capability}`);
  }

  async activate(appId: string, ctx: PlatformContext): Promise<void> {
    const app = this.apps.get(appId);
    if (!app) throw new Error(`unknown app: ${appId}`);
    if (this.active.has(appId)) return;
    await app.activate(ctx);
    this.active.add(appId);
  }

  async deactivate(appId: string): Promise<void> {
    const app = this.apps.get(appId);
    if (!app || !this.active.has(appId)) return;
    await app.deactivate?.();
    this.active.delete(appId);
  }

  isActive(appId: string): boolean {
    return this.active.has(appId);
  }
}
