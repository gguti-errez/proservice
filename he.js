'use strict';
/*
 * Control de horas extras (módulo del servidor de mttos).
 *   - Técnico (colab): registra y ve SOLO sus propias horas. Edita/elimina mientras estén pendientes o devueltas.
 *   - Administrador (master): ve todo, autoriza o devuelve, consulta el resumen del período y exporta a Excel.
 *   - Cliente (user): sin acceso.
 * Todo se valida aquí, en el servidor. Las colecciones he_reg y he_fer no son accesibles por /api/col
 * (scopeOf no las conoce), así que no hay otra ruta para leerlas.
 * Solo cuenta horas por categoría (diurnas, nocturnas, dobles); no calcula valores monetarios.
 */
const crypto = require('crypto');

const COL = 'he_reg';   // registros de horas
const COLF = 'he_fer';  // feriados adicionales definidos por el administrador
const TIPOS = ['Mtto. Preventivo', 'Mtto. Correctivo', 'Instalación/Retiro de equipo', 'Apoyo Operativo', 'Otros'];
const DIA_INI = 5 * 60;   // jornada diurna: 5:00 a. m. ...
const DIA_FIN = 19 * 60;  // ... a 7:00 p. m. (lo demás es nocturno)
const MAX_MIN = 16 * 60;  // un registro no puede pasar de 16 h
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const HM = /^([01]\d|2[0-3]):[0-5]\d$/;
const HEX = /^h[a-f0-9]{16}$/;

const pad = (n) => String(n).padStart(2, '0');
const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
const dmy = (d) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;
const hoyHN = () => { const d = new Date(Date.now() - 6 * 3600e3); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`; }; // hora de Honduras (UTC-6)
const validDate = (s) => typeof s === 'string' && DATE.test(s) && new Date(s + 'T00:00:00Z').toISOString().slice(0, 10) === s;
const dayNum = (d) => Math.round(Date.parse(d + 'T00:00:00Z') / 86400000);
const addDays = (d, n) => { const t = new Date(d + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
const dow = (d) => new Date(d + 'T00:00:00Z').getUTCDay(); // 0 = domingo
const toMin = (h) => +h.slice(0, 2) * 60 + +h.slice(3, 5);
const r2 = (x) => Math.round(x * 100) / 100;
const isObj = (d) => d && typeof d === 'object' && !Array.isArray(d);
const clean = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u001f<>"]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);

/* ---------- feriados ---------- */
const FIJOS = [['01-01', 'Año Nuevo'], ['04-14', 'Día de las Américas'], ['05-01', 'Día del Trabajo'], ['09-15', 'Día de la Independencia'], ['12-25', 'Navidad']];
const SEMANA_SANTA = ['2026-04-02', '2026-04-03', '2026-04-04', '2027-03-25', '2027-03-26', '2027-03-27', '2028-04-13', '2028-04-14', '2028-04-15'];
function feriados(col) {
  const s = new Map();
  for (const y of [2026, 2027, 2028]) for (const [md, n] of FIJOS) s.set(`${y}-${md}`, n);
  for (const d of SEMANA_SANTA) s.set(d, 'Semana Santa');
  try { // calendario de feriados que ya usa el plan de mttos, si trae fechas
    for (const [id, d] of Object.entries(col('feriados'))) {
      const vals = [id];
      if (isObj(d)) for (const v of Object.values(d)) Array.isArray(v) ? vals.push(...v) : vals.push(v);
      for (const v of vals) if (validDate(v)) s.set(v, (isObj(d) && typeof d.n === 'string' && d.n) || s.get(v) || 'Feriado');
    }
  } catch (e) { /* sin esa colección */ }
  for (const d of Object.values(col(COLF))) if (d && validDate(d.f)) s.set(d.f, clean(d.n, 60) || 'Feriado');
  return s;
}

/* ---------- clasificación: diurnas / nocturnas / dobles (en minutos) ----------
 * Diurna 5:00–19:00. Domingos y feriados cuentan completos como dobles. Si cruza la medianoche se divide por día. */
function classify(f, hi, hf, fer) {
  const a = toMin(hi); let b = toMin(hf); if (b <= a) b += 1440;
  const segs = [[f, a, Math.min(b, 1440)]];
  if (b > 1440) segs.push([addDays(f, 1), 0, b - 1440]);
  let d = 0, n = 0, x = 0;
  for (const [day, s, e] of segs) {
    const mins = e - s; if (mins <= 0) continue;
    if (dow(day) === 0 || fer.has(day)) { x += mins; continue; }
    const dd = Math.max(0, Math.min(e, DIA_FIN) - Math.max(s, DIA_INI));
    d += dd; n += mins - dd;
  }
  return { d, n, x, t: d + n + x };
}
const durMin = (hi, hf) => { const a = toMin(hi); let b = toMin(hf); if (b <= a) b += 1440; return b - a; };
const hrs = (h) => ({ d: r2(h.d / 60), n: r2(h.n / 60), x: r2(h.x / 60), t: r2(h.t / 60) });

/* ---------- período de pago: del 15 del mes anterior al 14 del mes de cierre ---------- */
function periodOf(y, m) {
  const ini = new Date(Date.UTC(y, m - 2, 15)).toISOString().slice(0, 10);
  const fin = new Date(Date.UTC(y, m - 1, 14)).toISOString().slice(0, 10);
  return { y, m, ini, fin };
}
function currentPeriod() {
  const h = hoyHN(); const y = +h.slice(0, 4), m = +h.slice(5, 7), d = +h.slice(8, 10);
  return d >= 15 ? (m === 12 ? periodOf(y + 1, 1) : periodOf(y, m + 1)) : periodOf(y, m);
}
function periodFromQuery(q) {
  const y = parseInt(q.y, 10), m = parseInt(q.m, 10);
  if (y >= 2020 && y <= 2100 && m >= 1 && m <= 12) return periodOf(y, m);
  return currentPeriod();
}

/* ---------- validación de un registro ---------- */
function parseReg(b, hoy) {
  if (!isObj(b)) return { error: 'Solicitud inválida.' };
  const f = String(b.f || ''), hi = String(b.hi || ''), hf = String(b.hf || '');
  if (!validDate(f)) return { error: 'Escribe una fecha válida.' };
  if (f > hoy) return { error: 'No se puede registrar una fecha futura.' };
  if (f < '2020-01-01') return { error: 'La fecha es demasiado antigua.' };
  if (!HM.test(hi) || !HM.test(hf)) return { error: 'Escribe la hora de inicio y la de fin (formato 24 horas, por ejemplo 19:30).' };
  if (hi === hf) return { error: 'La hora de inicio y la de fin no pueden ser iguales.' };
  if (durMin(hi, hf) > MAX_MIN) return { error: 'Un registro no puede pasar de 16 horas. Si fue más, sepáralo en dos registros.' };
  const t = String(b.t || '');
  if (!TIPOS.includes(t)) return { error: 'Elige un tipo de observación.' };
  const o = clean(b.o, 300);
  if (t === 'Otros' && !o) return { error: 'En "Otros" debes detallar la observación.' };
  let v = 0; // horas de viaje (opcional): aparecen en la columna "Horas de viaje" del reporte
  if (b.v !== undefined && b.v !== null && String(b.v).trim() !== '') {
    v = Number(String(b.v).replace(',', '.'));
    if (!isFinite(v) || v < 0 || v > 16) return { error: 'Las horas de viaje deben estar entre 0 y 16.' };
    v = r2(v);
  }
  return { f, hi, hf, t, o, v };
}
function overlaps(col, uid, f, hi, hf, selfId) {
  const base = dayNum(f) * 1440, s = base + toMin(hi), e = s + durMin(hi, hf);
  for (const [id, r] of Object.entries(col(COL))) {
    if (!r || r.u !== uid || id === selfId) continue;
    if (Math.abs(dayNum(r.f) - dayNum(f)) > 1) continue;
    const s2 = dayNum(r.f) * 1440 + toMin(r.hi), e2 = s2 + durMin(r.hi, r.hf);
    if (s < e2 && s2 < e) return true;
  }
  return false;
}
const pushLog = (r, who, a) => { r.log = (Array.isArray(r.log) ? r.log : []).concat({ t: new Date().toISOString(), u: who, a }).slice(-20); };

/* ---------- vistas ---------- */
function view(id, r, fer, users) {
  const h = r.s === 'A' && r.h ? r.h : classify(r.f, r.hi, r.hf, fer);
  const live = users[r.u];
  return {
    id, u: r.u, un: (live && live.name) || r.un || '—', f: r.f, hi: r.hi, hf: r.hf, t: r.t, o: r.o || '', v: r.v || 0, s: r.s, c: r.c,
    tarde: !!r.tarde, aby: r.aby || '', aat: r.aat || '', nota: r.nota || '', h: hrs(h), log: Array.isArray(r.log) ? r.log : []
  };
}
const add3 = (acc, h) => { acc[0] += h.d; acc[1] += h.n; acc[2] += h.x; };
const out3 = (a) => a.map((v) => r2(v / 60));

function periodData(ctx, per) {
  const { col } = ctx; const users = ctx.users(); const fer = feriados(col);
  const colabs = {}; const tipos = {}; const dias = {};
  const ensure = (uid, nm) => colabs[uid] || (colabs[uid] = { u: uid, n: nm, a: [0, 0, 0], p: [0, 0, 0], dev: 0, pn: 0, tarde: 0, nreg: 0 });
  for (const u of Object.values(users)) if (u.role === 'colab' && u.active) ensure(u.id, u.name);
  const det = [];
  for (const [id, r] of Object.entries(col(COL))) {
    if (!r || r.f < per.ini || r.f > per.fin) continue;
    const v = view(id, r, fer, users);
    const c = ensure(r.u, v.un);
    det.push(v);
    if (r.s === 'D') { c.dev++; continue; }
    const h = r.s === 'A' && r.h ? r.h : classify(r.f, r.hi, r.hf, fer);
    const k = r.s === 'A' ? 'a' : 'p';
    add3(c[k], h); c.nreg++; if (r.tarde) c.tarde++; if (r.s === 'P') c.pn++;
    const tp = tipos[r.t] = tipos[r.t] || { a: [0, 0, 0], p: [0, 0, 0] }; add3(tp[k], h);
    const du = dias[r.u] = dias[r.u] || {}; const dd = du[r.f] = du[r.f] || { a: [0, 0, 0], p: [0, 0, 0] }; add3(dd[k], h);
  }
  const list = Object.values(colabs).map((c) => ({ ...c, a: out3(c.a), p: out3(c.p) })).sort((x, y) => x.n.localeCompare(y.n, 'es'));
  const tl = Object.entries(tipos).map(([t, v]) => ({ t, a: out3(v.a), p: out3(v.p) }));
  const dl = {}; for (const [u, days] of Object.entries(dias)) { dl[u] = {}; for (const [d, v] of Object.entries(days)) dl[u][d] = { a: out3(v.a), p: out3(v.p) }; }
  const fp = [...fer].filter(([f]) => f >= per.ini && f <= per.fin).map(([f, n]) => ({ f, n })).sort((a, b) => (a.f < b.f ? -1 : 1));
  det.sort((a, b) => (a.f < b.f ? -1 : a.f > b.f ? 1 : a.hi < b.hi ? -1 : 1));
  return { periodo: per, colabs: list, tipos: tl, dias: dl, feriados: fp, det };
}

/* ---------- rutas ---------- */
async function handle(req, res, url, U, ctx) {
  const { send, jsonBody, col, saveSoon, refresh } = ctx;
  const p = url.pathname, M = req.method; let m;
  if (U.role !== 'master' && U.role !== 'colab') return send(res, 403, { error: 'Este módulo es solo para técnicos y administradores.' }, refresh);
  const admin = U.role === 'master';
  const hoy = hoyHN();
  const users = ctx.users();

  if (p === '/api/he/config' && M === 'GET') {
    const fer = feriados(col);
    const extra = admin ? Object.entries(col(COLF)).filter(([, d]) => d && validDate(d.f)).map(([id, d]) => ({ id, f: d.f, n: d.n || '' })).sort((a, b) => (a.f < b.f ? -1 : 1)) : [];
    const fl = [...fer].map(([f, n]) => ({ f, n })).sort((a, b) => (a.f < b.f ? -1 : 1));
    return send(res, 200, { hoy, tipos: TIPOS, me: { id: U.id, name: U.name, role: U.role }, periodo: currentPeriod(), feriados: fl, extra, diurno: ['05:00', '19:00'] }, refresh);
  }

  if (p === '/api/he/calc' && M === 'GET') {
    const q = Object.fromEntries(url.searchParams);
    const v = parseReg({ f: q.f, hi: q.hi, hf: q.hf, t: TIPOS[0] }, hoy);
    if (v.error) return send(res, 200, { error: v.error }, refresh);
    const fer = feriados(col);
    const h = hrs(classify(v.f, v.hi, v.hf, fer));
    const dobles = [];
    const segs = [v.f]; if (toMin(v.hf) <= toMin(v.hi)) segs.push(addDays(v.f, 1));
    for (const d of segs) if (dow(d) === 0 || fer.has(d)) dobles.push(d === v.f ? 'el día de inicio' : 'el día siguiente');
    return send(res, 200, { h, tarde: hoy > addDays(v.f, 1), dobles, solapa: !admin && overlaps(col, U.id, v.f, v.hi, v.hf, HEX.test(q.id || '') ? q.id : '') }, refresh);
  }

  if (p === '/api/he/reg' && M === 'GET') {
    const q = Object.fromEntries(url.searchParams);
    const from = validDate(q.from) ? q.from : '', to = validDate(q.to) ? q.to : '';
    const fer = feriados(col);
    let out = [];
    for (const [id, r] of Object.entries(col(COL))) {
      if (!r) continue;
      if (!admin && r.u !== U.id) continue;                       // el técnico solo ve lo suyo
      if (admin && q.u && /^[a-f0-9]{12}$/.test(q.u) && r.u !== q.u) continue;
      if (from && r.f < from) continue; if (to && r.f > to) continue;
      if (['P', 'A', 'D'].includes(q.s) && r.s !== q.s) continue;
      out.push(view(id, r, fer, users));
    }
    out.sort((a, b) => (a.f < b.f ? 1 : a.f > b.f ? -1 : a.hi < b.hi ? 1 : -1));
    return send(res, 200, out.slice(0, 3000), refresh);
  }

  if (p === '/api/he/reg' && M === 'POST') {
    if (admin) return send(res, 403, { error: 'Los administradores autorizan; cada técnico registra sus propias horas.' }, refresh);
    const b = await jsonBody(req, 4096);
    const v = parseReg(b, hoy); if (v.error) return send(res, 400, { error: v.error }, refresh);
    if (overlaps(col, U.id, v.f, v.hi, v.hf, '')) return send(res, 409, { error: 'Ese horario se cruza con otro registro tuyo.' }, refresh);
    const id = 'h' + crypto.randomBytes(8).toString('hex'), now = new Date().toISOString();
    const rec = { u: U.id, un: U.name, ...v, s: 'P', c: now, cd: hoy, tarde: hoy > addDays(v.f, 1) };
    pushLog(rec, U.name, 'registró');
    col(COL)[id] = rec; saveSoon();
    return send(res, 200, view(id, rec, feriados(col), users), refresh);
  }

  if ((m = p.match(/^\/api\/he\/reg\/(h[a-f0-9]{16})$/))) {
    const id = m[1], r = col(COL)[id];
    if (!r || (!admin && r.u !== U.id)) return send(res, 404, { error: 'No existe' }, refresh); // no se revela si existe
    if (M === 'PUT') {
      if (admin) return send(res, 403, { error: 'El administrador puede devolver el registro para que el técnico lo corrija.' }, refresh);
      if (r.s === 'A') return send(res, 403, { error: 'Un registro autorizado solo lo puede reabrir un administrador.' }, refresh);
      const v = parseReg(await jsonBody(req, 4096), hoy); if (v.error) return send(res, 400, { error: v.error }, refresh);
      if (overlaps(col, U.id, v.f, v.hi, v.hf, id)) return send(res, 409, { error: 'Ese horario se cruza con otro registro tuyo.' }, refresh);
      Object.assign(r, v); r.s = 'P'; r.nota = ''; r.tarde = r.tarde || hoy > addDays(v.f, 1);
      pushLog(r, U.name, 'editó'); saveSoon();
      return send(res, 200, view(id, r, feriados(col), users), refresh);
    }
    if (M === 'DELETE') {
      if (!admin && r.s === 'A') return send(res, 403, { error: 'Un registro autorizado solo lo puede eliminar un administrador.' }, refresh);
      delete col(COL)[id]; saveSoon();
      return send(res, 200, { ok: true }, refresh);
    }
  }

  /* autorizar / devolver / reabrir (solo administrador) */
  if ((m = p.match(/^\/api\/he\/reg\/(h[a-f0-9]{16})\/estado$/)) && M === 'POST') {
    if (!admin) return send(res, 403, { error: 'Solo un administrador puede autorizar.' }, refresh);
    const r = col(COL)[m[1]]; if (!r) return send(res, 404, { error: 'No existe' }, refresh);
    const b = await jsonBody(req, 2048); if (!isObj(b)) return send(res, 400, { error: 'Solicitud inválida.' }, refresh);
    const fer = feriados(col);
    if (b.accion === 'aut') {
      if (r.s === 'A') return send(res, 409, { error: 'Ya está autorizado.' }, refresh);
      r.h = classify(r.f, r.hi, r.hf, fer); r.s = 'A'; r.aby = U.name; r.aat = new Date().toISOString(); r.nota = '';
      pushLog(r, U.name, 'autorizó');
    } else if (b.accion === 'dev') {
      const nota = clean(b.nota, 200); if (!nota) return send(res, 400, { error: 'Escribe el motivo de la devolución.' }, refresh);
      if (r.s === 'A') delete r.h;
      r.s = 'D'; r.nota = nota; r.aby = ''; r.aat = ''; pushLog(r, U.name, 'devolvió: ' + nota);
    } else if (b.accion === 'abrir') {
      if (r.s !== 'A') return send(res, 409, { error: 'Solo se reabren registros autorizados.' }, refresh);
      delete r.h; r.s = 'P'; r.aby = ''; r.aat = ''; pushLog(r, U.name, 'reabrió');
    } else return send(res, 400, { error: 'Acción inválida.' }, refresh);
    saveSoon();
    return send(res, 200, view(m[1], r, fer, users), refresh);
  }
  if (p === '/api/he/autorizar-lote' && M === 'POST') {
    if (!admin) return send(res, 403, { error: 'Solo un administrador puede autorizar.' }, refresh);
    const b = await jsonBody(req, 16384);
    if (!isObj(b) || !Array.isArray(b.ids) || b.ids.length > 300) return send(res, 400, { error: 'Solicitud inválida.' }, refresh);
    const fer = feriados(col); let n = 0;
    for (const id of b.ids) {
      const r = HEX.test(String(id)) && col(COL)[id];
      if (!r || r.s !== 'P') continue;
      r.h = classify(r.f, r.hi, r.hf, fer); r.s = 'A'; r.aby = U.name; r.aat = new Date().toISOString(); r.nota = '';
      pushLog(r, U.name, 'autorizó'); n++;
    }
    if (n) saveSoon();
    return send(res, 200, { ok: true, n }, refresh);
  }

  /* resumen del período, calendario y exportación (solo administrador) */
  if (p === '/api/he/resumen' && M === 'GET') {
    if (!admin) return send(res, 403, { error: 'Solo los administradores ven el resumen del equipo.' }, refresh);
    const per = periodFromQuery(Object.fromEntries(url.searchParams));
    const d = periodData(ctx, per);
    delete d.det;
    return send(res, 200, d, refresh);
  }
  if (p === '/api/he/export.xlsx' && M === 'GET') {
    if (!admin) return send(res, 403, { error: 'Solo los administradores pueden exportar.' }, refresh);
    const per = periodFromQuery(Object.fromEntries(url.searchParams));
    const d = periodData(ctx, per);
    const stamp = new Date(Date.now() - 6 * 3600e3).toISOString().slice(0, 16).replace('T', ' ');
    const { xlsx, hd, d2 } = require('./reports');
    const ST = { P: 'Pendiente', A: 'Autorizado', D: 'Devuelto' };
    const sum = d.colabs.reduce((a, c) => ({ d: a.d + c.a[0], n: a.n + c.a[1], x: a.x + c.a[2], p: a.p + c.p[0] + c.p[1] + c.p[2] }), { d: 0, n: 0, x: 0, p: 0 });
    const resumen = [
      [{ v: 'Control de horas extras · Plan de mttos PBS', st: 3 }], [],
      ['Período', `${per.ini} al ${per.fin}`], ['Emitido', stamp], ['Emitido por', U.name || U.user],
      ['Nota', 'Solo horas autorizadas en las columnas de totales; las pendientes se muestran aparte. Sin valores monetarios.'], [],
      hd(['Colaborador', 'Diurnas (h)', 'Nocturnas (h)', 'Dobles (h)', 'Total autorizado (h)', 'Pendientes de autorizar (h)', 'Devueltos', 'Fuera de plazo']),
      ...d.colabs.map((c) => [c.n, d2(c.a[0]), d2(c.a[1]), d2(c.a[2]), d2(r2(c.a[0] + c.a[1] + c.a[2])), d2(r2(c.p[0] + c.p[1] + c.p[2])), c.dev, c.tarde]),
      [{ v: 'TOTAL', st: 1 }, d2(r2(sum.d)), d2(r2(sum.n)), d2(r2(sum.x)), d2(r2(sum.d + sum.n + sum.x)), d2(r2(sum.p)), d.colabs.reduce((a, c) => a + c.dev, 0), d.colabs.reduce((a, c) => a + c.tarde, 0)]
    ];
    const tipos = [hd(['Tipo de observación', 'Diurnas (h)', 'Nocturnas (h)', 'Dobles (h)', 'Total autorizado (h)', 'Pendientes (h)']),
      ...d.tipos.map((t) => [t.t, d2(t.a[0]), d2(t.a[1]), d2(t.a[2]), d2(r2(t.a[0] + t.a[1] + t.a[2])), d2(r2(t.p[0] + t.p[1] + t.p[2]))])];
    const det = [hd(['Fecha', 'Colaborador', 'Inicio', 'Fin', 'Tipo', 'Observación', 'Diurnas (h)', 'Nocturnas (h)', 'Dobles (h)', 'Total (h)', 'Horas de viaje', 'Estado', 'Autorizado por', 'Motivo de devolución', 'Fuera de plazo']),
      ...d.det.map((r) => [r.f, r.un, r.hi, r.hf, r.t, r.o, d2(r.h.d), d2(r.h.n), d2(r.h.x), d2(r.h.t), r.v ? d2(r.v) : '', ST[r.s], r.aby, r.nota, r.tarde ? 'Sí' : ''])];
    const buf = xlsx([
      { name: 'Resumen', rows: resumen, widths: [30, 13, 14, 12, 20, 26, 11, 14] },
      { name: 'Por tipo', rows: tipos, widths: [32, 13, 14, 12, 20, 15] },
      { name: 'Detalle', rows: det, widths: [12, 26, 8, 8, 28, 40, 12, 13, 11, 10, 13, 12, 22, 34, 14] }
    ]);
    res.writeHead(200, { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': `attachment; filename="horas-extras-${per.fin}.xlsx"`, 'Cache-Control': 'no-store', ...refresh });
    return res.end(buf);
  }

  /* Reporte de Horas Extras en el formato oficial (.xlsx). Solo con el período ya cerrado y solo horas autorizadas.
   * Técnico: el suyo. Administrador: el de un colaborador (u=<id>) o el de todos (u=todos), una hoja por colaborador. */
  if (p === '/api/he/reporte.xlsx' && M === 'GET') {
    const q = Object.fromEntries(url.searchParams); const per = periodFromQuery(q);
    if (per.fin >= hoy) return send(res, 409, { error: `El período termina el ${dmy(per.fin)}. El reporte se puede descargar a partir del ${dmy(addDays(per.fin, 1))}.` }, refresh);
    const target = admin ? (/^[a-f0-9]{12}$/.test(q.u || '') ? q.u : 'todos') : U.id;
    const fer = feriados(col), emp = col('he_emp'), by = {}, names = {};
    for (const r of Object.values(col(COL))) {
      if (!r || r.s !== 'A' || r.f < per.ini || r.f > per.fin || (target !== 'todos' && r.u !== target)) continue;
      const h = r.h || classify(r.f, r.hi, r.hf, fer);
      (by[r.u] = by[r.u] || []).push({ f: r.f, hi: r.hi, hf: r.hf, d: r2(h.d / 60), n: r2(h.n / 60), x: r2(h.x / 60), desc: r.t + (r.o ? ': ' + r.o : ''), v: r.v || 0 });
      names[r.u] = (users[r.u] && users[r.u].name) || r.un || 'Colaborador';
    }
    const mes = `${MESES[per.m - 1]} ${per.y} (${dmy(per.ini)} al ${dmy(per.fin)})`;
    const emps = Object.keys(by).map((uid) => {
      const e = isObj(emp[uid]) ? emp[uid] : {};
      return { nombre: names[uid], cod: e.cod || '', dep: e.dep || '', mes, recs: by[uid].sort((a, b) => (a.f < b.f ? -1 : a.f > b.f ? 1 : a.hi < b.hi ? -1 : 1)) };
    }).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
    if (!emps.length) return send(res, 404, { error: admin ? 'No hay horas autorizadas en este período para el reporte.' : 'No tienes horas autorizadas en este período.' }, refresh);
    const buf = require('./he-form').buildWorkbook(emps);
    const slug = (emps.length === 1 ? emps[0].nombre : 'Todos').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'Colaborador';
    res.writeHead(200, { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': `attachment; filename="Reporte-Horas-Extras-${slug}-${per.fin}.xlsx"`, 'Cache-Control': 'no-store', ...refresh });
    return res.end(buf);
  }

  /* código y departamento que se imprimen en el reporte (solo administrador) */
  if (p === '/api/he/empleados' && M === 'GET') {
    if (!admin) return send(res, 403, { error: 'Solo un administrador edita los datos del reporte.' }, refresh);
    const emp = col('he_emp');
    return send(res, 200, Object.values(users).filter((u) => u.role === 'colab').map((u) => ({ id: u.id, name: u.name, user: u.user, active: !!u.active, cod: (emp[u.id] && emp[u.id].cod) || '', dep: (emp[u.id] && emp[u.id].dep) || '' }))
      .sort((a, b) => (a.active === b.active ? a.name.localeCompare(b.name, 'es') : a.active ? -1 : 1)), refresh);
  }
  if ((m = p.match(/^\/api\/he\/empleados\/([a-f0-9]{12})$/)) && M === 'PUT') {
    if (!admin) return send(res, 403, { error: 'Solo un administrador edita los datos del reporte.' }, refresh);
    if (!users[m[1]] || users[m[1]].role !== 'colab') return send(res, 404, { error: 'No existe' }, refresh);
    const b = await jsonBody(req, 2048); if (!isObj(b)) return send(res, 400, { error: 'Solicitud inválida.' }, refresh);
    col('he_emp')[m[1]] = { cod: clean(b.cod, 30), dep: clean(b.dep, 60) }; saveSoon();
    return send(res, 200, { ok: true }, refresh);
  }

  /* feriados adicionales (solo administrador) */
  if (p === '/api/he/feriados' && M === 'PUT') {
    if (!admin) return send(res, 403, { error: 'Solo un administrador edita los feriados.' }, refresh);
    const b = await jsonBody(req, 16384);
    if (!isObj(b) || !Array.isArray(b.list) || b.list.length > 200) return send(res, 400, { error: 'Solicitud inválida.' }, refresh);
    const next = {};
    for (const it of b.list) {
      if (!isObj(it) || !validDate(it.f)) return send(res, 400, { error: 'Hay una fecha de feriado inválida.' }, refresh);
      next['f' + it.f] = { f: it.f, n: clean(it.n, 60) || 'Feriado' };
    }
    const cur = col(COLF);
    for (const k of Object.keys(cur)) delete cur[k];
    Object.assign(cur, next); saveSoon();
    return send(res, 200, { ok: true, n: Object.keys(next).length }, refresh);
  }

  return send(res, 404, { error: 'No encontrado' }, refresh);
}

module.exports = { handle, classify, feriados, periodOf };
