import { useState } from 'react';
import type { User } from '@fusion/shared-types';
import { api, setToken } from '../api.js';

export function Login({ onLogin }: { onLogin: (u: User) => void }) {
  const [username, setUsername] = useState('supervisor');
  const [password, setPassword] = useState('demo');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr('');
    try {
      const { token, user } = await api.login(username, password);
      setToken(token);
      onLogin(user);
    } catch (e) {
      setErr((e as Error).message === 'invalid credentials' ? 'Unknown operator. Try: supervisor, operator, analyst, admin.' : (e as Error).message);
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
        <div className="field">
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
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="any value in demo" />
        </div>
        <button className="btn" disabled={busy}>{busy ? 'Signing in…' : 'Enter Operations Center'}</button>
        {err && <div className="err">{err}</div>}
        <div className="hint">Demo mode · any password is accepted · production uses Keycloak / OIDC</div>
      </form>
    </div>
  );
}
