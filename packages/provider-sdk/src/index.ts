import type {
  Capability,
  PlatformContext,
  PlatformProvider,
  ProviderHealth,
} from '@fusion/platform-contracts';

export class ProviderRegistry {
  private readonly providers = new Map<string, PlatformProvider>();

  register(provider: PlatformProvider): void {
    const id = provider.manifest.id;
    if (this.providers.has(id)) throw new Error(`provider already registered: ${id}`);
    this.providers.set(id, provider);
  }

  unregister(providerId: string): void {
    this.providers.delete(providerId);
  }

  get(providerId: string): PlatformProvider | undefined {
    return this.providers.get(providerId);
  }

  list(capability?: Capability): PlatformProvider[] {
    const values = [...this.providers.values()];
    return capability
      ? values.filter((provider) => provider.manifest.capabilities.includes(capability))
      : values;
  }

  async startAll(ctx: PlatformContext): Promise<void> {
    for (const provider of this.providers.values()) await provider.start?.(ctx);
  }

  async stopAll(): Promise<void> {
    for (const provider of [...this.providers.values()].reverse()) await provider.stop?.();
  }

  async health(): Promise<ProviderHealth[]> {
    const result: ProviderHealth[] = [];
    for (const provider of this.providers.values()) {
      if (provider.health) result.push(await provider.health());
      else {
        result.push({
          providerId: provider.manifest.id,
          state: 'ready',
          checkedAt: Date.now(),
        });
      }
    }
    return result;
  }
}

export function providerSupports(provider: PlatformProvider, capability: Capability): boolean {
  return provider.manifest.capabilities.includes(capability);
}
