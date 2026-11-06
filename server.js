'use strict';
/*
 * Plataforma de Mantenimientos (multicliente) — servidor
 * Sin dependencias externas. Requiere Node.js 18 o superior.
 *   - Sirve la página (carpeta /public)
 *   - Guarda los datos en un archivo JSON (DATA_DIR/data.json)
 *   - Guarda PDF/JPG en DATA_DIR/uploads
 *   - Tiempo real con Server-Sent Events (/api/stream)
 *   - Cuentas individuales con perfiles master / colaborador / usuario (cliente)
 *   - Las claves y permisos se validan AQUÍ, en el servidor
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');


const PORT = parseInt(process.env.PORT || '3000', 10);
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const DATA_FILE = path.join(DATA_DIR, 'data.json');
const PUBLIC_DIR = path.join(__dirname, 'public');
const SESSION_MIN = parseInt(process.env.SESSION_MINUTES || '60', 10);
const MASTER_USER = (process.env.MASTER_USER || 'admin').toLowerCase();
const MAX_UPLOAD = 10 * 1024 * 1024;
const MAX_DOC = 64 * 1024;
const SETUP_CODE = process.env.SETUP_CODE || '';

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

/* ---------- datos ---------- */
let DB = { cols: {}, users: {}, secret: crypto.randomBytes(32).toString('hex') };
try {
  const raw = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  if (raw && raw.cols) DB = { secret: raw.secret || DB.secret, cols: raw.cols, users: raw.users || {} };
} catch (e) { /* primer arranque */ }
let saveTimer = null;
function saveSoon() { clearTimeout(saveTimer); saveTimer = setTimeout(saveNow, 300); }
function saveNow() {
  const tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(DB));
  fs.renameSync(tmp, DATA_FILE);
}
process.on('SIGTERM', () => { saveNow(); process.exit(0); });
process.on('SIGINT', () => { saveNow(); process.exit(0); });
const col = (n) => (DB.cols[n] = DB.cols[n] || {});
const ID_OK = /^[A-Za-z0-9_.:~@+-]{1,120}$/;
const SLUG_OK = /^[a-z0-9]{2,12}$/;

/* ---------- cuentas ---------- */
const hashPw = (pw, salt) => crypto.scryptSync(String(pw), salt, 32).toString('hex');
function makeUser(o) {
  const salt = crypto.randomBytes(16).toString('hex');
  return { id: o.id || crypto.randomBytes(6).toString('hex'), user: o.user, name: o.name, role: o.role, client: o.client || null, active: true, salt, hash: hashPw(o.password, salt), pv: 1, at: Date.now() };
}
function setPassword(u, pw) { u.salt = crypto.randomBytes(16).toString('hex'); u.hash = hashPw(pw, u.salt); u.pv = (u.pv || 1) + 1; }
const checkPw = (u, pw) => {
  const a = Buffer.from(hashPw(pw, u ? u.salt : 'x'.repeat(32)), 'hex');
  const b = Buffer.from(u ? u.hash : '0'.repeat(64), 'hex');
  return !!u && crypto.timingSafeEqual(a, b);
};
const pub = (u) => ({ id: u.id, user: u.user, name: u.name, role: u.role, client: u.client, active: u.active, cargo: u.cargo || '', tel: u.tel || '', email: u.email || '', color: u.color || '' });
const masterUser = () => Object.values(DB.users).find((u) => u.role === 'master');
const otherAdmin = (id) => Object.values(DB.users).some((u) => u.role === 'master' && u.active && u.id !== id);
(function bootstrap() {
  if (!Object.keys(col('clientes')).length) col('clientes').corinsa = { n: 'CORINSA', freq: 6, active: true };
  const m = Object.values(DB.users).find((u) => u.role === 'master' && u.user === MASTER_USER) || masterUser();
  const pw = process.env.APP_PASSWORD;
  if (!m) {
    if (pw && pw.length >= 8) {
      const u = makeUser({ user: MASTER_USER, name: 'Administrador', role: 'master', password: pw });
      DB.users[u.id] = u; saveNow();
      console.log('Cuenta "' + MASTER_USER + '" creada con APP_PASSWORD. Cambia la clave desde la plataforma.');
    } else {
      saveNow();
      console.log('Aún no existe la cuenta "' + MASTER_USER + '": al abrir la página se pedirá definir su contraseña.' + (SETUP_CODE ? ' (requiere SETUP_CODE)' : ''));
    }
  } else if (process.env.RESET_MASTER === '1' && pw && pw.length >= 8) {
    setPassword(m, pw); m.active = true; saveNow();
    console.log('Clave del master restablecida con APP_PASSWORD. Quita RESET_MASTER para no repetirlo.');
  } else saveNow();
})();

/* ---------- sesión: cookie firmada, vence por inactividad ---------- */
function sign(payload) {
  const b = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return b + '.' + crypto.createHmac('sha256', DB.secret).update(b).digest('base64url');
}
function verify(tok) {
  if (!tok || typeof tok !== 'string') return null;
  const [b, m] = tok.split('.');
  if (!b || !m) return null;
  const ok = crypto.createHmac('sha256', DB.secret).update(b).digest('base64url');
  if (m.length !== ok.length || !crypto.timingSafeEqual(Buffer.from(m), Buffer.from(ok))) return null;
  try { const p = JSON.parse(Buffer.from(b, 'base64url').toString()); return p.exp > Date.now() ? p : null; } catch (e) { return null; }
}
function cookieOf(req, k) {
  const h = req.headers.cookie || '';
  for (const part of h.split(';')) { const i = part.indexOf('='); if (i > 0 && part.slice(0, i).trim() === k) return part.slice(i + 1).trim(); }
  return '';
}
function session(req) {
  const p = verify(cookieOf(req, 'sid'));
  if (!p) return null;
  const u = DB.users[p.u];
  if (!u || !u.active || u.pv !== p.pv) return null;
  if (u.role === 'user' && !(col('clientes')[u.client] && col('clientes')[u.client].active !== false)) return null;
  return { u, exp: p.exp };
}
const isHttps = (req) => req.headers['x-forwarded-proto'] === 'https';
function cookieHdr(req, u) {
  const tok = sign({ u: u.id, pv: u.pv, exp: Date.now() + SESSION_MIN * 60000 });
  return 'sid=' + tok + '; HttpOnly; SameSite=Strict; Path=/; Max-Age=' + SESSION_MIN * 60 + (isHttps(req) ? '; Secure' : '');
}
const clearCookie = 'sid=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0';
const fails = new Map();
function ipOf(req) { return (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim(); }

/* ---------- permisos por colección ---------- */
function scopeOf(c) {
  if (c === 'clientes') return { g: 'clientes' };
  if (c === 'feriados') return { g: 'feriados' };
  if (/^(avance|equipos|bitacora|ciclos)$/.test(c)) return { client: 'corinsa', kind: c };
  let m;
  if ((m = c.match(/^c[A-Za-z0-9]{1,8}_(avance|equipos|bitacora)$/))) return { client: 'corinsa', kind: m[1] };
  if ((m = c.match(/^x([a-z0-9]{2,12})_ciclos$/))) return { client: m[1], kind: 'ciclos' };
  if ((m = c.match(/^x([a-z0-9]{2,12})_[A-Za-z0-9]{1,8}_(avance|equipos|bitacora)$/))) return { client: m[1], kind: m[2] };
  return null;
}
const clientOk = (slug) => !!col('clientes')[slug];
function canRead(u, c) {
  const s = scopeOf(c); if (!s) return false;
  if (s.client && !clientOk(s.client)) return false;
  if (u.role === 'master' || u.role === 'colab') return true;
  if (s.g === 'feriados' || s.g === 'clientes') return true;
  return s.client === u.client;
}
function canWrite(u, c, method, data) {
  const s = scopeOf(c); if (!s) return false;
  if (s.client && !clientOk(s.client)) return false;
  if (u.role === 'master') return true;
  if (u.role !== 'colab') return false;
  if (s.g === 'clientes') return false;
  if (s.kind === 'equipos' && (method === 'DELETE' || (data && data.del))) return false; // colaborador no elimina equipos
  return true;
}
let SEED = null;
const seedBase = (id) => {
  if (!/^e\d{3}$/.test(id)) return null;
  if (!SEED) { try { SEED = JSON.parse(fs.readFileSync(path.join(__dirname, 'seed-corinsa.json'), 'utf8')); } catch (e) { SEED = []; } }
  return SEED[parseInt(id.slice(1), 10) - 1] || null;
};
const nz = (v) => (v == null || v === '' ? '' : String(v));
/* reglas extra del colaborador: un equipo listo solo lo reabre/edita un administrador, y en el equipo solo cambia localidad y ubicación */
const okSig = (f) => f == null || (typeof f === 'object' && typeof f.img === 'string' && /^data:image\/png;base64,[A-Za-z0-9+\/=]{20,40000}$/.test(f.img));
const badFirma = (d) => !!d && (!okSig(d.firma) || (d.vis != null && (!Array.isArray(d.vis) || d.vis.length > 30 || d.vis.some((v) => !v || typeof v !== 'object' || !okSig(v.firma)))));
function colabRule(u, c, id, data) {
  if (u.role !== 'colab') return null;
  const s = scopeOf(c); if (!s) return null;
  if (s.kind === 'avance') {
    let cur = col(c)[id];
    if (!cur && c === 'avance') { const b = seedBase(id); if (b && b.s === 'L') cur = { s: 'L' }; }
    if (cur && cur.s === 'L') return 'Un equipo marcado como listo solo puede modificarlo un administrador.';
    if (cur && cur.s === 'R' && data) {
      if (data.s === 'P') return 'Un equipo en espera de repuesto solo puede volver a pendiente un administrador.';
      if (data.s === 'R') {
        const j = (v) => JSON.stringify(v == null || (Array.isArray(v) && !v.length) ? '' : v); const fid = (f) => (Array.isArray(f) ? f.map((x) => x && x.id) : []);
        const msg = 'En espera de repuesto, el checklist, los contadores y la evidencia solo los modifica un administrador.';
        for (const k of ['chk', 'cont', 'cbn', 'ccl', 'hi', 'hf']) if (j(cur[k]) !== j(data[k])) return msg;
        if (j(fid(cur.files)) !== j(fid(data.files))) return msg;
      }
    }
  }
  if (s.kind === 'equipos') {
    let cur = col(c)[id];
    if (c === 'equipos') { const b = seedBase(id); if (b) cur = Object.assign({}, b, cur || {}); }
    if (cur && data) for (const k of ['e', 'm', 'sn', 'd', 'cb']) if (nz(cur[k]) !== nz(data[k])) return 'Los colaboradores solo pueden modificar la localidad y la ubicación de la impresora.';
  }
  return null;
}
function visibleDocs(u, c) {
  let out = Object.entries(col(c));
  if (c === 'clientes') {
    if (u.role === 'user') out = out.filter(([id]) => id === u.client);
    else if (u.role === 'colab') out = out.filter(([, d]) => d.active !== false);
  }
  return out.map(([id, data]) => ({ id, data }));
}

/* ---------- tiempo real ---------- */
const streams = new Set(); // {res, id, pv, exp}
function broadcast(c, payload) {
  for (const st of streams) {
    const u = DB.users[st.id];
    if (!u || !u.active || u.pv !== st.pv || !canRead(u, c)) continue;
    if (c === 'clientes' && u.role === 'user' && payload.id !== u.client) continue;
    st.res.write('data: ' + JSON.stringify({ col: c, ...payload }) + '\n\n');
  }
}
setInterval(() => {
  for (const st of [...streams]) {
    const u = DB.users[st.id];
    if (!u || !u.active || u.pv !== st.pv || Date.now() > st.exp) { st.res.write('data: {"auth":false}\n\n'); st.res.end(); streams.delete(st); }
    else st.res.write(': ping\n\n');
  }
}, 25000);

/* ---------- utilidades HTTP ---------- */
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml' };
function send(res, code, obj, headers) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(JSON.stringify(obj));
}
function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const parts = []; let n = 0;
    req.on('data', (c) => { n += c.length; if (n > limit) { reject(Object.assign(new Error('too_large'), { code: 413 })); req.destroy(); return; } parts.push(c); });
    req.on('end', () => resolve(Buffer.concat(parts)));
    req.on('error', reject);
  });
}
async function jsonBody(req, limit) { try { return JSON.parse((await readBody(req, limit)).toString() || '{}'); } catch (e) { return undefined; } }
const isObj = (d) => d && typeof d === 'object' && !Array.isArray(d);
const SEC = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin', 'X-Frame-Options': 'SAMEORIGIN' };
const nameOk = (s) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, 40);

function validateCliente(id, d) {
  if (!SLUG_OK.test(id) || id === 'x') return 'El código del cliente debe tener 2 a 12 letras minúsculas o números.';
  if (!isObj(d) || !String(d.n || '').trim() || String(d.n).length > 60) return 'Escribe el nombre del cliente (máx. 60 caracteres).';
  const f = d.freq; if (!Number.isInteger(f) || f < 1 || f > 36) return 'La frecuencia debe ser de 1 a 36 meses.';
  return '';
}

/* ---------- servidor ---------- */
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    const p = url.pathname;
    for (const [k, v] of Object.entries(SEC)) res.setHeader(k, v);
    if (p === '/healthz') return send(res, 200, { ok: true });

    /* configuración inicial: definir la clave de la cuenta admin (solo mientras no exista) */
    if (p === '/api/setup' && req.method === 'GET') return send(res, 200, { needed: !masterUser(), code: !!SETUP_CODE, user: MASTER_USER });
    if (p === '/api/setup' && req.method === 'POST') {
      if (masterUser()) return send(res, 409, { error: 'La cuenta admin ya está configurada.' });
      const body = await jsonBody(req, 4096); if (!body) return send(res, 400, { error: 'Solicitud inválida' });
      const key = ipOf(req) + '|setup';
      const f = fails.get(key) || { n: 0, until: 0 };
      if (Date.now() < f.until) return send(res, 429, { error: 'Demasiados intentos. Espera un momento.', retry: Math.ceil((f.until - Date.now()) / 1000) });
      if (SETUP_CODE) {
        const a1 = crypto.createHash('sha256').update(String(body.code || '')).digest(), b1 = crypto.createHash('sha256').update(SETUP_CODE).digest();
        if (!crypto.timingSafeEqual(a1, b1)) { f.n++; if (f.n >= 4) { f.until = Date.now() + 60000; f.n = 0; } fails.set(key, f); return send(res, 403, { error: 'Código de configuración incorrecto.' }); }
      }
      const pw = String(body.password || '');
      if (pw.length < 8) return send(res, 400, { error: 'La contraseña debe tener al menos 8 caracteres.' });
      const u = makeUser({ user: MASTER_USER, name: 'Administrador', role: 'master', password: pw });
      DB.users[u.id] = u; saveNow();
      return send(res, 200, { me: pub(u), minutes: SESSION_MIN }, { 'Set-Cookie': cookieHdr(req, u) });
    }

    /* login / sesión */
    if (p === '/api/login' && req.method === 'POST') {
      const body = await jsonBody(req, 4096); if (!body) return send(res, 400, { error: 'Solicitud inválida' });
      const login = String(body.user || '').trim().toLowerCase();
      const key = ipOf(req) + '|' + login;
      const f = fails.get(key) || { n: 0, until: 0 };
      if (Date.now() < f.until) return send(res, 429, { error: 'Demasiados intentos. Espera un momento.', retry: Math.ceil((f.until - Date.now()) / 1000) });
      const u = Object.values(DB.users).find((x) => x.user === login);
      const ok = checkPw(u, String(body.password || ''));
      if (!ok || !u.active) {
        f.n++; if (f.n >= 4) { f.until = Date.now() + 60000; f.n = 0; }
        fails.set(key, f);
        return send(res, 401, { error: 'Usuario o contraseña incorrectos.' });
      }
      fails.delete(key);
      return send(res, 200, { me: pub(u), minutes: SESSION_MIN }, { 'Set-Cookie': cookieHdr(req, u) });
    }
    if (p === '/api/logout' && req.method === 'POST') return send(res, 200, { ok: true }, { 'Set-Cookie': clearCookie });
    const S = session(req);
    const need = () => { send(res, 401, { error: 'Sesión vencida' }, { 'Set-Cookie': clearCookie }); return null; };
    if (p.startsWith('/api/') || p.startsWith('/uploads/')) {
      if (!S) return need();
    }
    const U = S && S.u;
    const refresh = S ? { 'Set-Cookie': cookieHdr(req, U) } : {};
    let m;

    if (p === '/api/me' && req.method === 'GET') return send(res, 200, { me: pub(U), minutes: SESSION_MIN }, refresh);
    if (p === '/api/password' && req.method === 'POST') {
      const b = await jsonBody(req, 4096); if (!b) return send(res, 400, { error: 'Solicitud inválida' });
      if (!checkPw(U, String(b.old || ''))) return send(res, 403, { error: 'La clave actual no es correcta.' });
      if (String(b.new || '').length < 8) return send(res, 400, { error: 'La nueva clave debe tener al menos 8 caracteres.' });
      setPassword(U, String(b.new)); saveSoon();
      return send(res, 200, { ok: true }, { 'Set-Cookie': cookieHdr(req, U) });
    }

    if (p === '/api/profile' && req.method === 'PUT') {
      const b = await jsonBody(req, 2048); if (!b || typeof b !== 'object') return send(res, 400, { error: 'Solicitud inválida' });
      const cl = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u001f<>"]/g, '').trim().slice(0, n);
      const email = cl(b.email, 80);
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return send(res, 400, { error: 'El correo no es válido.' });
      U.cargo = cl(b.cargo, 60); U.tel = cl(b.tel, 30); U.email = email; U.color = /^#[0-9a-f]{6}$/i.test(String(b.color || '')) ? String(b.color) : '';
      saveSoon();
      return send(res, 200, { me: pub(U) }, refresh);
    }

    /* administración de cuentas (solo master) */
    if (p === '/api/users' || (m = p.match(/^\/api\/users\/([a-f0-9]{12})$/))) {
      if (U.role !== 'master') return send(res, 403, { error: 'Solo el master administra cuentas.' });
      if (p === '/api/users' && req.method === 'GET') return send(res, 200, Object.values(DB.users).map(pub), refresh);
      if (p === '/api/users' && req.method === 'POST') {
        const b = await jsonBody(req, 4096); if (!b) return send(res, 400, { error: 'Solicitud inválida' });
        const user = String(b.user || '').trim().toLowerCase();
        if (!/^[a-z0-9._-]{3,24}$/.test(user)) return send(res, 400, { error: 'Usuario: 3 a 24 caracteres (letras, números, punto, guion).' });
        if (Object.values(DB.users).some((x) => x.user === user)) return send(res, 400, { error: 'Ese usuario ya existe.' });
        if (String(b.password || '').length < 8) return send(res, 400, { error: 'La clave debe tener al menos 8 caracteres.' });
        if (!['master', 'colab', 'user'].includes(b.role)) return send(res, 400, { error: 'Perfil inválido.' });
        const name = nameOk(b.name) || user;
        let client = null;
        if (b.role === 'user') { client = String(b.client || ''); if (!clientOk(client)) return send(res, 400, { error: 'Elige el cliente de este usuario.' }); }
        const nu = makeUser({ user, name, role: b.role, client, password: String(b.password) });
        DB.users[nu.id] = nu; saveSoon();
        return send(res, 200, pub(nu), refresh);
      }
      const t = m && DB.users[m[1]];
      if (!t) return send(res, 404, { error: 'No existe' });
      if (req.method === 'PUT') {
        const b = await jsonBody(req, 4096); if (!b) return send(res, 400, { error: 'Solicitud inválida' });
        if (b.name != null) t.name = nameOk(b.name) || t.name;
        if (b.password != null && b.password !== '') { if (String(b.password).length < 8) return send(res, 400, { error: 'La clave debe tener al menos 8 caracteres.' }); setPassword(t, String(b.password)); }
        if (b.client != null && t.role === 'user') { if (!clientOk(b.client)) return send(res, 400, { error: 'Cliente inexistente.' }); t.client = b.client; }
        if (b.active != null) {
          if (!b.active && t.id === U.id) return send(res, 400, { error: 'No puedes desactivar tu propia cuenta.' });
          if (!b.active && t.role === 'master' && t.active && !otherAdmin(t.id)) return send(res, 400, { error: 'Debe quedar al menos un administrador activo.' });
          t.active = !!b.active;
        }
        saveSoon();
        return send(res, 200, pub(t), t.id === U.id && b.password ? { 'Set-Cookie': cookieHdr(req, U) } : refresh);
      }
      if (req.method === 'DELETE') {
        if (t.id === U.id) return send(res, 400, { error: 'No puedes eliminar tu propia cuenta.' });
        if (t.role === 'master' && t.active && !otherAdmin(t.id)) return send(res, 400, { error: 'Debe quedar al menos un administrador activo.' });
        delete DB.users[t.id]; saveSoon();
        return send(res, 200, { ok: true }, refresh);
      }
    }

    /* tiempo real */
    if (p === '/api/stream' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
      res.write('retry: 3000\n\n');
      const st = { res, id: U.id, pv: U.pv, exp: S.exp }; streams.add(st);
      req.on('close', () => streams.delete(st));
      return;
    }

    /* colecciones */
    if ((m = p.match(/^\/api\/col\/([^/]+)$/))) {
      const c = decodeURIComponent(m[1]);
      if (!scopeOf(c) || !canRead(U, c)) return send(res, 404, { error: 'No existe' });
      if (req.method === 'GET') return send(res, 200, visibleDocs(U, c), refresh);
      if (req.method === 'POST') {
        const data = await jsonBody(req, MAX_DOC);
        if (!isObj(data)) return send(res, 400, { error: 'Documento inválido' });
        if (!canWrite(U, c, 'POST', data)) return send(res, 403, { error: 'Tu perfil no permite este cambio.' });
        const id = Date.now().toString(36) + crypto.randomBytes(4).toString('hex');
        col(c)[id] = data; saveSoon(); broadcast(c, { id, data });
        return send(res, 200, { id }, refresh);
      }
    }
    if ((m = p.match(/^\/api\/bulk\/([^/]+)$/)) && req.method === 'POST') {
      const c = decodeURIComponent(m[1]);
      if (!scopeOf(c) || !canRead(U, c)) return send(res, 404, { error: 'No existe' });
      const b = await jsonBody(req, 2 * 1024 * 1024);
      if (!canWrite(U, c, 'PUT', null)) return send(res, 403, { error: 'Tu perfil no permite este cambio.' });
      if (!b || !Array.isArray(b.docs) || b.docs.length > 1000) return send(res, 400, { error: 'Lote inválido (máx. 1000 equipos).' });
      for (const d of b.docs) {
        if (!d || !ID_OK.test(String(d.id)) || !isObj(d.data) || JSON.stringify(d.data).length > MAX_DOC) return send(res, 400, { error: 'Lote con datos inválidos.' });
        if (!canWrite(U, c, 'PUT', d.data)) return send(res, 403, { error: 'Tu perfil no permite este cambio.' });
        { const er = colabRule(U, c, String(d.id), d.data); if (er) return send(res, 403, { error: er }); }
        if (badFirma(d.data)) return send(res, 400, { error: 'Firma inválida.' });
      }
      for (const d of b.docs) col(c)[d.id] = d.data;
      saveSoon();
      broadcast(c, { bulk: b.docs.map((d) => ({ id: d.id, data: d.data })) });
      return send(res, 200, { ok: true, n: b.docs.length }, refresh);
    }
    if ((m = p.match(/^\/api\/doc\/([^/]+)\/([^/]+)$/))) {
      const c = decodeURIComponent(m[1]), id = decodeURIComponent(m[2]);
      if (!scopeOf(c) || !ID_OK.test(id) || !canRead(U, c)) return send(res, 404, { error: 'No existe' });
      if (req.method === 'GET') { const d = col(c)[id]; return d ? send(res, 200, d, refresh) : send(res, 404, { error: 'No existe' }); }
      if (req.method === 'PUT') {
        const data = await jsonBody(req, MAX_DOC);
        if (!isObj(data)) return send(res, 400, { error: 'Documento inválido' });
        if (!canWrite(U, c, 'PUT', data)) return send(res, 403, { error: 'Tu perfil no permite este cambio.' });
        { const er = colabRule(U, c, id, data); if (er) return send(res, 403, { error: er }); }
        if (badFirma(data)) return send(res, 400, { error: 'Firma inválida.' });
        if (c === 'clientes') { const e = validateCliente(id, data); if (e) return send(res, 400, { error: e }); data.active = data.active !== false; }
        col(c)[id] = data; saveSoon(); broadcast(c, { id, data });
        return send(res, 200, { ok: true }, refresh);
      }
      if (req.method === 'DELETE') {
        if (!canWrite(U, c, 'DELETE', null) || c === 'clientes') return send(res, 403, { error: 'Tu perfil no permite eliminar.' });
        { const er = colabRule(U, c, id, null); if (er) return send(res, 403, { error: er }); }
        delete col(c)[id]; saveSoon(); broadcast(c, { id, data: null });
        return send(res, 200, { ok: true }, refresh);
      }
    }

    /* evidencias: el nombre lleva el código del cliente, y se valida al descargar */
    if (p === '/api/upload' && req.method === 'POST') {
      if (U.role === 'user') return send(res, 403, { error: 'Tu perfil es de solo lectura.' });
      const cl = url.searchParams.get('c') || 'corinsa';
      if (!SLUG_OK.test(cl) || !clientOk(cl)) return send(res, 400, { error: 'Cliente inválido.' });
      let buf; try { buf = await readBody(req, MAX_UPLOAD); } catch (e) { return send(res, 413, { error: 'El archivo supera 10 MB.' }); }
      const isPdf = buf.slice(0, 5).toString() === '%PDF-';
      const isJpg = buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
      if (!isPdf && !isJpg) return send(res, 415, { error: 'Solo se permiten PDF o JPG.' });
      const id = (cl === 'corinsa' ? '' : cl + '_') + crypto.randomBytes(16).toString('hex') + (isPdf ? '.pdf' : '.jpg');
      fs.writeFileSync(path.join(UPLOAD_DIR, id), buf);
      return send(res, 200, { id, url: '/uploads/' + id }, refresh);
    }
    if ((m = p.match(/^\/uploads\/(?:([a-z0-9]{2,12})_)?([a-f0-9]{32})\.(pdf|jpg)$/)) && req.method === 'GET') {
      const owner = m[1] || 'corinsa';
      if (U.role === 'user' && U.client !== owner) return send(res, 404, { error: 'No existe' });
      const f = path.join(UPLOAD_DIR, path.basename(p));
      if (!fs.existsSync(f)) return send(res, 404, { error: 'No existe' });
      res.writeHead(200, { 'Content-Type': m[3] === 'pdf' ? 'application/pdf' : 'image/jpeg', 'Content-Disposition': 'inline', 'Cache-Control': 'private, no-store', ...refresh });
      return fs.createReadStream(f).pipe(res);
    }

    /* inventario base de CORINSA (plan 2026): solo para quien puede leer ese cliente */
    if (p === '/api/seed/corinsa' && req.method === 'GET') {
      if (!canRead(U, 'equipos')) return send(res, 404, { error: 'No existe' });
      try { return send(res, 200, JSON.parse(fs.readFileSync(path.join(__dirname, 'seed-corinsa.json'), 'utf8')), refresh); }
      catch (e) { return send(res, 200, [], refresh); }
    }

    /* Panel gerencial: métricas y exportación (solo administradores) */
    if ((p === '/api/metrics' || p === '/api/metrics.xlsx') && req.method === 'GET') {
      if (U.role !== 'master') return send(res, 403, { error: 'Solo los administradores pueden ver el panel gerencial.' });
      const q = Object.fromEntries(url.searchParams);
      const rep = require('./reports').report(col, DB.users, q);
      if (p === '/api/metrics') return send(res, 200, rep, refresh);
      const stamp = new Date(Date.now() - 6 * 3600e3).toISOString().slice(0, 16).replace('T', ' ');
      const buf = require('./reports').workbook(rep, stamp, U.name || U.user);
      res.writeHead(200, { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': `attachment; filename="panel-gerencial-${stamp.slice(0, 10)}.xlsx"`, 'Cache-Control': 'no-store', ...refresh });
      return res.end(buf);
    }

    /* respaldo completo (solo master, sin claves) */
    if (p === '/api/export' && req.method === 'GET') {
      if (U.role !== 'master') return send(res, 403, { error: 'Solo el master puede exportar.' });
      return send(res, 200, { exportado: new Date().toISOString(), cols: DB.cols, cuentas: Object.values(DB.users).map(pub) });
    }
    if (p.startsWith('/api/')) return send(res, 404, { error: 'No encontrado' });

    /* archivos estáticos */
    if (req.method === 'GET' || req.method === 'HEAD') {
      const rel = p === '/' ? '/index.html' : p;
      const f = path.normalize(path.join(PUBLIC_DIR, rel));
      if (!f.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end(); }
      if (fs.existsSync(f) && fs.statSync(f).isFile()) {
        res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
        return fs.createReadStream(f).pipe(res);
      }
    }
    send(res, 404, { error: 'No encontrado' });
  } catch (e) {
    if (!res.headersSent) send(res, e.code === 413 ? 413 : 500, { error: 'Error del servidor' });
    else res.end();
  }
});
server.listen(PORT, () => console.log(`Plataforma de Mantenimientos escuchando en http://localhost:${PORT}  (datos en ${DATA_DIR})`));
