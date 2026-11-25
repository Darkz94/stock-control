'use strict';

window.stockCloud = (() => {
  const endpoint = 'https://bvspqptddjuqrsyoeaql.supabase.co';
  const key = 'sb_publishable_ojcR4Ew1Q_xTPNvRZ-g1eg_ygtGFNdQ';
  const sessionKey = 'stock_control_session';
  let session;

  function setSession(value) {
    session = value;
    if (value) sessionStorage.setItem(sessionKey, JSON.stringify(value));
    else sessionStorage.removeItem(sessionKey);
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

  async function token() {
    if (!session) throw new Error('Sign in to continue.');
    if (session.expires_at <= Date.now() / 1000 + 45) {
      const refreshed = await request('/auth/v1/token?grant_type=refresh_token', {
        body: {refresh_token: session.refresh_token}
      });
      setSession(refreshed);
    }
    return session.access_token;
  }

  async function rpc(name, body) {
    return request('/rest/v1/rpc/' + name, {body}, await token());
  }

  return {
    async signIn(email, password) {
      const signedIn = await request('/auth/v1/token?grant_type=password', {body: {email, password}});
      setSession(signedIn);
    },
    restore() {
      try { session = JSON.parse(sessionStorage.getItem(sessionKey)); }
      catch { setSession(null); }
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
