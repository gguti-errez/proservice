'use strict';
/*
 * Almacenamiento persistente en Supabase (sin dependencias, solo HTTPS/fetch).
 *   - Datos: tabla public.mttos_docs (c, id, d jsonb). Equipos, avances, bitácora, firmas, cuentas, etc.
 *   - Evidencias (PDF/JPG): bucket privado de Supabase Storage.
 * Sin SUPABASE_URL y SUPABASE_SERVICE_KEY el servidor sigue usando solo archivos locales.
 * La llave secreta vive únicamente en variables de entorno del servidor; nunca va al navegador.
 */
const BASE = (process.env.SUPABASE_URL || '').trim().replace(/\/+$/, '');
const KEY = (process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SECRET_KEY || '').trim();
const BUCKET = process.env.SUPABASE_BUCKET || 'evidencias';
const TABLE = 'mttos_docs';
const enabled = !!(BASE && KEY);
const st = { ok: null, lastSync: 0, error: '', pending: 0, loaded: 0 };
const last = new Map(); // clave "c\u0000id" -> JSON enviado a Supabase
let timer = null, running = null, again = false, retry = null, lastPing = 0, getDB = null;

const hdr = (extra) => {
  const h = { apikey: KEY, 'User-Agent': 'plan-mttos-pbs-server', ...extra };
  if (!KEY.startsWith('sb_secret_')) h.Authorization = 'Bearer ' + KEY; // las llaves sb_secret_ no son JWT: solo van en apikey
  return h;
};
async function call(method, p, { body, headers, ms } = {}) {
  const r = await fetch(BASE + p, { method, headers: hdr(headers), body, signal: AbortSignal.timeout(ms || 25000) });
  if (!r.ok) {
    let t = ''; try { t = (await r.text()).slice(0, 200); } catch (e) { /* nada */ }
    const e = new Error(`Supabase ${method} ${p.split('?')[0]} → ${r.status} ${t}`.replace(KEY, '***')); e.status = r.status; throw e;
  }
  return r;
}

/* ---- aplanar la base en memoria a filas (c, id, d) ---- */
const SEP = '\u0000';
function rows(DB) {
  const out = new Map();
  const put = (c, id, v) => out.set(c + SEP + id, JSON.stringify(v !== null && typeof v === 'object' && !Array.isArray(v) ? v : { __v: v }));
  for (const [c, docs] of Object.entries(DB.cols)) for (const [id, v] of Object.entries(docs || {})) put(c, id, v);
  for (const [id, u] of Object.entries(DB.users)) put('__users', id, u);
  put('__meta', 'secret', { v: DB.secret });
  return out;
}
const unwrap = (d) => (d && typeof d === 'object' && Object.keys(d).length === 1 && '__v' in d ? d.__v : d);

/* ---- carga inicial: Supabase manda. Si está vacío, se sube lo que haya en el archivo local ---- */
async function load(DB) {
  getDB = () => DB;
  let off = 0, n = 0; const cols = {}, users = {}; let secret = null;
  for (;;) {
    const r = await call('GET', `/rest/v1/${TABLE}?select=c,id,d&order=c.asc,id.asc&limit=1000&offset=${off}`);
    const page = await r.json();
    for (const x of page) {
      n++; const k = x.c + SEP + x.id; last.set(k, JSON.stringify(x.d));
      if (x.c === '__users') users[x.id] = unwrap(x.d);
      else if (x.c === '__meta') { if (x.id === 'secret') secret = x.d && x.d.v; }
      else (cols[x.c] = cols[x.c] || {})[x.id] = unwrap(x.d);
    }
    if (page.length < 1000) break; off += 1000;
  }
  st.loaded = n;
  if (n > 0) { DB.cols = cols; DB.users = users; if (secret) DB.secret = secret; }
  st.ok = true; st.error = ''; st.lastSync = Date.now();
  return n;
}
async function loadRetry(DB) {
  let wait = 2000, err;
  for (let i = 0; i < 5; i++) {
    try { return await load(DB); } catch (e) { err = e; console.error('Supabase: no se pudo leer (' + (i + 1) + '/5): ' + e.message); await new Promise((r) => setTimeout(r, wait)); wait *= 2; }
  }
  throw err;
}

/* ---- escritura diferida: solo se envían filas nuevas, cambiadas o eliminadas ---- */
function schedule(ms = 1000) { if (!enabled) return; clearTimeout(timer); timer = setTimeout(() => { flush().catch(() => {}); }, ms); }
async function flush() {
  if (!enabled || !getDB) return;
  if (running) { again = true; return running; }
  running = (async () => {
    do {
      again = false;
      const cur = rows(getDB()); const up = [], del = [];
      for (const [k, v] of cur) if (last.get(k) !== v) up.push(k);
      for (const k of last.keys()) if (!cur.has(k)) del.push(k);
      st.pending = up.length + del.length;
      if (!st.pending) { st.ok = true; continue; }
      try {
        const now = new Date().toISOString(); let batch = [], size = 0, keys = [];
        const send = async () => { if (!batch.length) return; await call('POST', `/rest/v1/${TABLE}?on_conflict=c,id`, { body: JSON.stringify(batch), headers: { 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' } }); keys.forEach((k) => last.set(k, cur.get(k))); batch = []; keys = []; size = 0; };
        for (const k of up) {
          const [c, id] = k.split(SEP); const d = cur.get(k);
          batch.push({ c, id, d: JSON.parse(d), updated_at: now }); keys.push(k); size += d.length;
          if (batch.length >= 200 || size > 1.5e6) await send();
        }
        await send();
        for (const k of del) { const [c, id] = k.split(SEP); await call('DELETE', `/rest/v1/${TABLE}?c=eq.${encodeURIComponent(c)}&id=eq.${encodeURIComponent(id)}`); last.delete(k); }
        st.ok = true; st.error = ''; st.lastSync = Date.now(); st.pending = 0; clearTimeout(retry); retry = null;
      } catch (e) {
        st.ok = false; st.error = e.message; console.error('Supabase: error al guardar, se reintenta. ' + e.message);
        clearTimeout(retry); retry = setTimeout(() => { flush().catch(() => {}); }, 10000);
        return;
      }
    } while (again);
  })().finally(() => { running = null; });
  return running;
}
async function flushNow(ms = 8000) { if (!enabled) return; clearTimeout(timer); await Promise.race([flush(), new Promise((r) => setTimeout(r, ms))]); }

/* ---- evidencias en Storage ---- */
async function putObject(name, buf, type) {
  await call('POST', `/storage/v1/object/${BUCKET}/${encodeURIComponent(name)}`, { body: buf, headers: { 'Content-Type': type, 'x-upsert': 'true' }, ms: 60000 });
}
async function getObject(name) {
  try { const r = await call('GET', `/storage/v1/object/${BUCKET}/${encodeURIComponent(name)}`, { ms: 60000 }); return Buffer.from(await r.arrayBuffer()); }
  catch (e) { if (e.status === 400 || e.status === 404) return null; throw e; }
}

/* ---- evita que Supabase pause el proyecto por inactividad ---- */
function touch() {
  if (!enabled || Date.now() - lastPing < 30 * 60000) return; lastPing = Date.now();
  call('GET', `/rest/v1/${TABLE}?select=c&limit=1`).then(() => { st.ok = true; }).catch((e) => { st.ok = false; st.error = e.message; });
}
const status = () => ({ modo: enabled ? 'supabase' : 'archivo', ok: enabled ? st.ok : null, ultima: st.lastSync, pendientes: st.pending, filas: st.loaded, error: enabled ? st.error : '' });
module.exports = { enabled, loadRetry, schedule, flushNow, putObject, getObject, touch, status };
