import { useEffect, useState } from 'react';
import type { User } from '@fusion/shared-types';
import { api, getToken, setToken } from './api.js';
import { live } from './live-store.js';
import { Login } from './components/Login.js';
import { Shell } from './components/Shell.js';

export function App() {
  const [user, setUser] = useState<User | null>(null);
  const [booting, setBooting] = useState(true);

  useEffect(() => {
    if (!getToken()) { setBooting(false); return; }
    api.me()
      .then((u) => { setUser(u); void bootstrap(); })
      .catch(() => setToken(null))
      .finally(() => setBooting(false));
  }, []);

  async function bootstrap() {
    try {
      const [geofences, routes, tasks] = await Promise.all([api.geofences(), api.routes(), api.tasks()]);
      live.setStatic(geofences, routes);
      live.setTasks(tasks);
    } catch {
      /* reference data unavailable; live stream still hydrates the COP */
    }
    live.connect();
  }

  async function onLogin(u: User) {
    setUser(u);
    await bootstrap();
  }

  function logout() {
    setToken(null);
    setUser(null);
    location.reload();
  }

  if (booting) return <div className="login"><div className="mono" style={{ color: 'var(--muted)' }}>Loading…</div></div>;
  if (!user) return <Login onLogin={onLogin} />;
  return <Shell user={user} onLogout={logout} />;
}
