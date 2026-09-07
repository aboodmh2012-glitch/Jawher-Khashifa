import { UserManager, WebStorageStateStore } from 'oidc-client-ts';
import { setToken } from './api.js';
const env = import.meta.env as Record<string, string | undefined>;
export const identity = env.VITE_OIDC_ISSUER && env.VITE_OIDC_CLIENT_ID ? new UserManager({
  authority: env.VITE_OIDC_ISSUER, client_id: env.VITE_OIDC_CLIENT_ID,
  redirect_uri: window.location.origin + '/', post_logout_redirect_uri: window.location.origin + '/',
  response_type: 'code', scope: 'openid profile', automaticSilentRenew: false,
  userStore: new WebStorageStateStore({ store: window.sessionStorage }),
}) : null;
let callback: Promise<void> | undefined;
export function completeSignIn(): Promise<void> {
  if (callback) return callback; // React StrictMode must not redeem the code twice.
  if (!identity || !new URLSearchParams(location.search).has('state')) return Promise.resolve();
  callback = (async () => {
    try { const user = await identity.signinRedirectCallback(); setToken(user.access_token); }
    finally { history.replaceState(null, '', location.pathname); }
  })();
  return callback;
}
