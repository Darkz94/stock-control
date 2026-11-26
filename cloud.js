'use strict';

window.stockCloud = (() => {
  const endpoint = 'https://bvspqptddjuqrsyoeaql.supabase.co';
  const key = 'sb_publishable_ojcR4Ew1Q_xTPNvRZ-g1eg_ygtGFNdQ';
  const sessionKey = 'stock_control_session';
  const rememberedKey = 'stock_control_remembered_session';
  let session;
  let remember = false;
  let refreshInProgress;

  function readSession(storage, name) {
    try {
      const value = JSON.parse(storage.getItem(name));
      return value?.access_token && value?.refresh_token && Number.isFinite(value.expires_at) ? value : null;
    } catch { return null; }
  }

  function setSession(value) {
    session = value;
    sessionStorage.removeItem(sessionKey);
    localStorage.removeItem(rememberedKey);
    if (value) {
      const storage = remember ? localStorage : sessionStorage;
      storage.setItem(remember ? rememberedKey : sessionKey, JSON.stringify(value));
    }
  }

  async function request(path, options = {}, token) {
    const response = await fetch(endpoint + path, {
      method: options.body ? 'POST' : (options.method || 'GET'),
      headers: {
        apikey: key,
        'Content-Type': 'application/json',
        ...(token ? {Authorization: 'Bearer ' + token} : {})
      },
      body: options.body ? JSON.stringify(options.body) : undefined
    });
    const body = response.status === 204 ? null : await response.json();
    if (!response.ok) {
      throw Object.assign(new Error(body?.message || body?.msg || 'Request failed'), {status: response.status});
    }
    return body;
  }

  async function refreshSession() {
    if (remember) session = readSession(localStorage, rememberedKey);
    if (!session) throw new Error('Sign in to continue.');
    if (session.expires_at > Date.now() / 1000 + 45) return;
    const previous = session;
    try {
      const refreshed = await request('/auth/v1/token?grant_type=refresh_token', {
        body: {refresh_token: previous.refresh_token}
      });
      if (session?.refresh_token === previous.refresh_token && (!remember || readSession(localStorage, rememberedKey)?.refresh_token === previous.refresh_token)) {
        session = refreshed;
        const storage = remember ? localStorage : sessionStorage;
        storage.setItem(remember ? rememberedKey : sessionKey, JSON.stringify(refreshed));
      }
    } catch (error) {
      if ([400, 401].includes(error.status) && session?.refresh_token === previous.refresh_token
          && (!remember || readSession(localStorage, rememberedKey)?.refresh_token === previous.refresh_token)) setSession(null);
      throw error;
    }
  }

  async function token() {
    if (remember) session = readSession(localStorage, rememberedKey);
    if (!session) throw new Error('Sign in to continue.');
    if (session.expires_at <= Date.now() / 1000 + 45) {
      if (!refreshInProgress) {
        const refresh = remember && navigator.locks
          ? navigator.locks.request(rememberedKey, refreshSession)
          : refreshSession();
        refreshInProgress = refresh.finally(() => { refreshInProgress = null; });
      }
      await refreshInProgress;
    }
    if (!session) throw new Error('Sign in to continue.');
    return session.access_token;
  }

  async function rpc(name, body) {
    return request('/rest/v1/rpc/' + name, {body}, await token());
  }

  return {
    async signIn(email, password, keepSignedIn = false) {
      const signedIn = await request('/auth/v1/token?grant_type=password', {body: {email, password}});
      remember = keepSignedIn;
      setSession(signedIn);
    },
    restore() {
      session = readSession(sessionStorage, sessionKey);
      remember = !session;
      if (remember) session = readSession(localStorage, rememberedKey);
      return Boolean(session);
    },
    async signOut() {
      try {
        if (session) await request('/auth/v1/logout?scope=local', {method: 'POST'}, await token());
      } finally { setSession(null); }
    },
    read: () => rpc('stock_control_read', {}),
    write: body => rpc('stock_control_write', body)
  };
})();
