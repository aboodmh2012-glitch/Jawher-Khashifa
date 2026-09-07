import { useEffect, useState } from 'react';
import type { User } from '@fusion/shared-types';
import { api, setToken } from '../api.js';
import { config } from '../config.js';
import { identity } from '../identity.js';

export function Login({ onLogin }: { onLogin: (u: User) => void }) {
  const [username, setUsername] = useState('supervisor');
  const [password, setPassword] = useState('demo');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<string>('loading');
  useEffect(() => { fetch(config.apiUrl + '/api/auth/config').then(r => { if (!r.ok) throw new Error('Sign-in unavailable'); return r.json(); }).then(c => setMode(c.mode)).catch(() => setMode('unavailable')); }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr('');
    if (mode === 'oidc') {
      try { if (!identity) throw new Error('Organization sign-in is not configured'); await identity.signinRedirect(); }
      catch (error) { setErr((error as Error).message); setBusy(false); }
      return;
    }
    try {
      const { token, user } = await api.login(username, password);
      setToken(token);
      onLogin(user);
    } catch (e) {
      setErr((e as Error).message === 'invalid credentials' ? 'Invalid username or password.' : (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login">
      <form className="card" onSubmit={submit}>
        <div className="logo">◈</div>
        <h1>Fusion Operations</h1>
        <div className="tag">Unified operations &amp; situational-awareness command center</div>
        {mode === 'demo' && <><div className="field">
          <label>Operator</label>
          <select value={username} onChange={(e) => setUsername(e.target.value)}>
            <option value="supervisor">supervisor — Ops Supervisor</option>
            <option value="operator">operator — Field Operator</option>
            <option value="analyst">analyst — Intel Analyst</option>
            <option value="admin">admin — Platform Admin</option>
          </select>
        </div>
        <div className="field">
          <label>Password</label>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Demo password" autoComplete="current-password" />
        </div>
        </>}
        <button className="btn" disabled={busy || !['demo', 'oidc'].includes(mode)}>{busy ? 'Signing in…' : mode === 'oidc' ? 'Sign in with your organization' : 'Enter Operations Center'}</button>
        {err && <div className="err">{err}</div>}
        <div className="hint">{mode === 'demo' ? 'Demo environment · default password: demo' : mode === 'oidc' ? 'Organization account · secure sign-in' : 'Connecting to sign-in service…'}</div>
      </form>
    </div>
  );
}
