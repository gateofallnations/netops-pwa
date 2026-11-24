/**
 * NetOps Hub — read-only API + password login for the PWA.
 * Cloudflare Worker with a KV binding named NETOPS_KV.
 * The CF token and password hashes never reach the browser.
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'public, max-age=30'
};

const COLLECTIONS = new Set([
  'users', 'servers', 'rahkaran', 'cheats', 'phone', 'ips', 'vcenters',
  'tickets', 'ticket_comments', 'ticket_activity', 'ticket_files', 'ticket_policies'
]);

function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, ...extraHeaders } });
}

function hexToBytes(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}

function bytesToHex(bytes) {
  return Array.from(new Uint8Array(bytes)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function verifyPassword(password, stored) {
  if (!stored || !stored.startsWith('pbkdf2$')) return stored === password;
  const parts = stored.split('$');
  if (parts.length !== 5) return false;
  const [, algo, iterations, saltHex, hashHex] = parts;
  const hash = algo === 'sha256' ? 'SHA-256' : 'SHA-1';
  try {
    const key = await crypto.subtle.importKey(
      'raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']
    );
    const bits = await crypto.subtle.deriveBits({
      name: 'PBKDF2',
      salt: hexToBytes(saltHex),
      iterations: Number(iterations),
      hash
    }, key, 256);
    return bytesToHex(bits) === hashHex.toLowerCase();
  } catch (e) {
    return false;
  }
}

async function login(request, env) {
  let body;
  try { body = await request.json(); } catch (e) { return json({ error: 'Bad request' }, 400); }
  const username = String(body.username || '').trim().toLowerCase();
  const password = String(body.password || '');
  if (!username || !password) return json({ ok: false, error: 'Missing credentials' }, 400);

  const raw = await env.NETOPS_KV.get('netops_users');
  if (!raw) return json({ ok: false, error: 'No users found' }, 401);
  const users = JSON.parse(raw).items || [];
  const user = users.find(u => String(u.username || '').trim().toLowerCase() === username);
  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    return json({ ok: false, error: 'Invalid username or password' }, 401);
  }
  return json({
    ok: true,
    user: { username: user.username, role: user.role, fullName: user.fullName }
  }, 200, { 'Cache-Control': 'no-store' });
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '');

    try {
      if (path === '/health') return json({ ok: true, service: 'netops-pwa-api', time: Date.now() });

      if (path === '/login' && request.method === 'POST') return await login(request, env);

      if (path === '/manifest') {
        const raw = await env.NETOPS_KV.get('netops_manifest');
        return json(raw ? JSON.parse(raw) : { collections: {} });
      }

      if (path === '/release') {
        const raw = await env.NETOPS_KV.get('netops_app_release');
        return json(raw ? JSON.parse(raw) : null);
      }

      const match = path.match(/^\/collection\/([\w-]+)$/);
      if (match && COLLECTIONS.has(match[1])) {
        const raw = await env.NETOPS_KV.get('netops_' + match[1]);
        if (!raw) return json({ collection: match[1], version: 0, items: [] });
        const data = JSON.parse(raw);
        const items = (data.items || []).map(item => {
          const copy = { ...item };
          delete copy.passwordHash;
          return copy;
        });
        return json({
          collection: match[1],
          version: data.version || 0,
          updatedAt: data.updatedAt || 0,
          items
        });
      }

      return json({ error: 'Not found' }, 404);
    } catch (error) {
      return json({ error: String(error && error.message || error) }, 500);
    }
  }
};
