// ---------------------------------------------------------------------------
//  Acces API : fetch + en-tete anti-CSRF + identifiant d'onglet
// ---------------------------------------------------------------------------

// Identifiant unique de l'onglet : permet d'ignorer nos propres evenements temps reel
export const CLIENT_ID = Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) =>
  b.toString(16).padStart(2, '0')
).join('');

let onUnauthorized = null;
export function setUnauthorizedHandler(fn) {
  onUnauthorized = fn;
}

async function request(method, url, body) {
  const opts = {
    method,
    credentials: 'same-origin',
    headers: { 'X-Requested-With': 'orbit', 'X-Client-Id': CLIENT_ID },
  };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(url, opts);
  } catch {
    throw Object.assign(new Error('Connexion au serveur impossible'), { status: 0 });
  }
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* pas de corps JSON */
  }
  if (!res.ok) {
    if (res.status === 401 && !url.startsWith('/api/auth/') && onUnauthorized) onUnauthorized();
    throw Object.assign(new Error(data?.error || `Erreur ${res.status}`), { status: res.status });
  }
  return data;
}

export const api = {
  get: (u) => request('GET', u),
  post: (u, b) => request('POST', u, b ?? {}),
  patch: (u, b) => request('PATCH', u, b ?? {}),
  del: (u) => request('DELETE', u),
};
