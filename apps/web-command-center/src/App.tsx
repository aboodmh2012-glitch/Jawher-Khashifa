import { useEffect, useState } from 'react';
import type { User } from '@fusion/shared-types';
import { api, getToken, setToken } from './api.js';
import { live } from './live-store.js';
import { Login } from './components/Login.js';
import { completeSignIn, identity } from './identity.js';
import { Shell } from './components/Shell.js';

export function App() {
  const [user, setUser] = useState<User | null>(null);
  const [booting, setBooting] = useState(true);

  useEffect(() => {
    let disposed = false;
    const expired = () => { setToken(null); live.disconnect(); setUser(null); };
    window.addEventListener('fusion:session-expired', expired);
    void (async () => {
      try {
        await completeSignIn();
        if (getToken()) { const u = await api.me(); if (!disposed) { setUser(u); await bootstrap(); } }
      } catch { if (!disposed) expired(); }
      finally { if (!disposed) setBooting(false); }
    })();
    return () => { disposed = true; window.removeEventListener('fusion:session-expired', expired); live.disconnect(); };
  }, []);

  async function bootstrap() {
    const session = getToken();
    if (!session) return;
    try {
      const [geofences, routes, tasks] = await Promise.all([api.geofences(), api.routes(), api.tasks()]);
      if (getToken() !== session) return;
      live.setStatic(geofences, routes);
      live.setTasks(tasks);
    } catch {
      /* reference data unavailable; live stream still hydrates the COP */
    }
    if (getToken() === session) live.connect();
  }

  async function onLogin(u: User) {
    setUser(u);
    await bootstrap();
  }

  function logout() {
    setToken(null);
    setUser(null);
    live.disconnect();
    if (identity) void identity.signoutRedirect();
  }

  if (booting) return <div className="login"><div className="mono" style={{ color: 'var(--muted)' }}>Loading…</div></div>;
  if (!user) return <Login onLogin={onLogin} />;
  return <Shell user={user} onLogout={logout} />;
}
