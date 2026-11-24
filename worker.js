/**
 * NetOps Hub — API for the PWA (read + Creator-only user management).
 * Cloudflare Worker with a KV binding named NETOPS_KV.
 * The CF token and password hashes never reach the browser.
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json; charset=utf-8'
};

const COLLECTIONS = new Set([
  'users', 'servers', 'rahkaran', 'cheats', 'phone', 'ips', 'vcenters',
  'tickets', 'ticket_comments', 'ticket_activity', 'ticket_files', 'ticket_policies',
  'audit_log'
]);

function json(body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, ...extra } });
}
function hexToBytes(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}
function bytesToHex(bytes) {
  return Array.from(new Uint8Array(bytes)).map(b => b.toString(16).padStart(2, '0')).join('');
}
function randomHex(bytes) {
  return bytesToHex(crypto.getRandomValues(new Uint8Array(bytes)));
}

async function derive(password, saltHex, iterations, hashName, bits = 256) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  return await crypto.subtle.deriveBits({
    name: 'PBKDF2', salt: hexToBytes(saltHex), iterations, hash: hashName
  }, key, bits);
}
async function verifyPassword(password, stored) {
  if (!stored || !stored.startsWith('pbkdf2$')) return stored === password;
  const [, algo, iterations, saltHex, hashHex] = stored.split('$');
  if (!algo || !iterations || !saltHex || !hashHex) return false;
  if (Number(iterations) > 100000) return false; // Workers محدودیت ۱۰۰هزار تکرار دارد
  const bits = await derive(password, saltHex, Number(iterations), algo === 'sha256' ? 'SHA-256' : 'SHA-1');
  return bytesToHex(bits) === hashHex.toLowerCase();
}
async function hashPassword(password) {
  const salt = randomHex(16);
  const bits = await derive(password, salt, 100000, 'SHA-256');
  return `pbkdf2$sha256$100000$${salt}$${bytesToHex(bits)}`;
}

async function readCollection(env, name) {
  const raw = await env.NETOPS_KV.get('netops_' + name);
  return raw ? JSON.parse(raw) : { collection: name, version: 0, items: [] };
}
async function writeCollection(env, name, data) {
  const next = { ...data, collection: name, version: (data.version || 0) + 1, updatedAt: Date.now() };
  await env.NETOPS_KV.put('netops_' + name, JSON.stringify(next));
  const rawManifest = await env.NETOPS_KV.get('netops_manifest');
  const manifest = rawManifest ? JSON.parse(rawManifest) : { schema: 2, collections: {} };
  manifest.collections[name] = { version: next.version, updatedAt: Date.now(), count: next.items.length };
  manifest.updatedAt = Date.now();
  await env.NETOPS_KV.put('netops_manifest', JSON.stringify(manifest));
  return next;
}
async function appendAudit(env, actor, action, target, detail) {
  const data = await readCollection(env, 'audit_log');
  data.items.unshift({
    id: crypto.randomUUID(), actorId: actor, action, target: target || '',
    detail: detail || '', createdAt: Date.now(), pendingSync: false
  });
  data.items = data.items.slice(0, 5000);
  await writeCollection(env, 'audit_log', data);
}

async function readBody(request) {
  try { return await request.json(); } catch (e) { return {}; }
}
async function requireCreator(env, body) {
  const actor = String(body.actor || '').trim().toLowerCase();
  const password = String(body.actorPassword || '');
  const users = (await readCollection(env, 'users')).items || [];
  const creator = users.find(u => String(u.username || '').toLowerCase() === actor);
  if (!creator || creator.role !== 'CREATOR' || !(await verifyPassword(password, creator.passwordHash))) {
    return null;
  }
  return creator;
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    const path = new URL(request.url).pathname.replace(/\/+$/, '');

    try {
      if (path === '/health') return json({ ok: true, service: 'netops-pwa-api', time: Date.now() });

      if (path === '/login' && request.method === 'POST') {
        const body = await readBody(request);
        const username = String(body.username || '').trim().toLowerCase();
        const password = String(body.password || '');
        const users = (await readCollection(env, 'users')).items || [];
        const user = users.find(u => String(u.username || '').trim().toLowerCase() === username);
        if (!user || !password) {
          return json({ ok: false, error: 'Invalid username or password' }, 401, { 'Cache-Control': 'no-store' });
        }
        const stored = String(user.passwordHash || '');
        const parts = stored.split('$');
        if (parts[0] === 'pbkdf2' && Number(parts[2]) > 100000) {
          return json({ ok: false, error: 'Sign in once in the Android app to upgrade your password hash.' }, 401, { 'Cache-Control': 'no-store' });
        }
        if (!(await verifyPassword(password, stored))) {
          return json({ ok: false, error: 'Invalid username or password' }, 401, { 'Cache-Control': 'no-store' });
        }
        await appendAudit(env, user.username, 'login', 'app', 'web');
        return json({ ok: true, user: { username: user.username, role: user.role, fullName: user.fullName } }, 200, { 'Cache-Control': 'no-store' });
      }

      if (path === '/manifest') {
        const raw = await env.NETOPS_KV.get('netops_manifest');
        return json(raw ? JSON.parse(raw) : { collections: {} });
      }
      if (path === '/release') {
        const raw = await env.NETOPS_KV.get('netops_app_release');
        return json(raw ? JSON.parse(raw) : null);
      }
      if (path === '/audit') {
        return json({ items: (await readCollection(env, 'audit_log')).items || [] });
      }

      if (path === '/password' && request.method === 'POST') {
        const body = await readBody(request);
        const actor = await requireCreator(env, body);
        if (!actor) return json({ error: 'Creator authentication required' }, 403);
        const username = String(body.username || '').trim().toLowerCase();
        const nextPassword = String(body.newPassword || '');
        if (nextPassword.length < 6) return json({ error: 'Password too short' }, 400);
        const data = await readCollection(env, 'users');
        const target = (data.items || []).find(u => String(u.username || '').toLowerCase() === username);
        if (!target) return json({ error: 'User not found' }, 404);
        target.passwordHash = await hashPassword(nextPassword);
        await writeCollection(env, 'users', data);
        await appendAudit(env, actor.username, 'password_changed', target.username, 'by_creator_web');
        return json({ ok: true });
      }

      if (path === '/password/self' && request.method === 'POST') {
        const body = await readBody(request);
        const username = String(body.username || '').trim().toLowerCase();
        const oldPassword = String(body.oldPassword || '');
        const nextPassword = String(body.newPassword || '');
        if (nextPassword.length < 6) return json({ error: 'Password too short' }, 400);
        const data = await readCollection(env, 'users');
        const target = (data.items || []).find(u => String(u.username || '').toLowerCase() === username);
        if (!target || !(await verifyPassword(oldPassword, target.passwordHash || ''))) {
          return json({ error: 'Current password is incorrect' }, 401);
        }
        target.passwordHash = await hashPassword(nextPassword);
        await writeCollection(env, 'users', data);
        await appendAudit(env, username, 'password_changed', username, 'self_web');
        return json({ ok: true });
      }

      if (path === '/user/delete' && request.method === 'POST') {
        const body = await readBody(request);
        const actor = await requireCreator(env, body);
        if (!actor) return json({ error: 'Creator authentication required' }, 403);
        const username = String(body.username || '').trim().toLowerCase();
        if (username === 'kourosh') return json({ error: 'Creator cannot be deleted' }, 400);
        const data = await readCollection(env, 'users');
        data.items = (data.items || []).filter(u => String(u.username || '').toLowerCase() !== username);
        await writeCollection(env, 'users', data);
        await appendAudit(env, actor.username, 'user_deleted', username, 'web');
        return json({ ok: true });
      }

      const match = path.match(/^\/collection\/([\w-]+)$/);
      if (match && COLLECTIONS.has(match[1])) {
        const data = await readCollection(env, match[1]);
        const items = (data.items || []).map(item => {
          const copy = { ...item };
          delete copy.passwordHash;
          return copy;
        });
        return json({ collection: match[1], version: data.version || 0, updatedAt: data.updatedAt || 0, items });
      }

      return json({ error: 'Not found' }, 404);
    } catch (error) {
      return json({ error: String(error && error.message || error) }, 500);
    }
  }
};
