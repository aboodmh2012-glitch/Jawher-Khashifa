const env = import.meta.env as Record<string, string | undefined>;

export const config = {
  apiUrl: env.VITE_API_URL ?? 'http://localhost:4000',
  wsUrl: env.VITE_WS_URL ?? 'ws://localhost:4000/ws',
  mapStyle: env.VITE_MAP_STYLE ?? 'https://demotiles.maplibre.org/style.json',
  center: [54.37, 24.47] as [number, number],
  zoom: 10,
};
