'use strict';
/* Métricas del Panel gerencial y exportación a Excel (sin dependencias). */
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

const pad = (n) => String(n).padStart(2, '0');
const todayStr = () => { const d = new Date(Date.now() - 6 * 3600e3); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`; }; // hora de Honduras (UTC-6)
const isDate = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
const mins = (hi, hf) => {
  if (!/^\d{2}:\d{2}$/.test(hi || '') || !/^\d{2}:\d{2}$/.test(hf || '')) return null;
  const m = (+hf.slice(0, 2)) * 60 + (+hf.slice(3, 5)) - ((+hi.slice(0, 2)) * 60 + (+hi.slice(3, 5)));
  return m > 0 && m <= 960 ? m : null;
};
const totalMin = (a) => { const f = mins(a.hi, a.hf); let t = f == null ? 0 : f, any = f != null; for (const v of Array.isArray(a.vis) ? a.vis : []) { const m = mins(v && v.hi, v && v.hf); if (m != null) { t += m; any = true; } } return any ? t : null; };
const r1 = (x) => Math.round(x * 10) / 10;
const r2 = (x) => Math.round(x * 100) / 100;
const pc = (a, b) => (b ? r1((a / b) * 100) : 0);
function weekKey(d) { const t = new Date(d + 'T00:00:00Z'); const w = (t.getUTCDay() + 6) % 7; t.setUTCDate(t.getUTCDate() - w); return t.toISOString().slice(0, 10); }
const periodKey = (d, g) => (g === 'day' ? d : g === 'week' ? weekKey(d) : d.slice(0, 7));

let SEED = null;
function seed() { if (!SEED) { try { SEED = JSON.parse(fs.readFileSync(path.join(__dirname, 'seed-corinsa.json'), 'utf8')); } catch (e) { SEED = []; } } return SEED; }

/* Todas las filas (equipo × plan × cliente) */
function collect(col) {
  const out = [];
  const clientes = col('clientes');
  for (const slug of Object.keys(clientes)) {
    const cl = clientes[slug]; if (!cl) continue;
    const cor = slug === 'corinsa';
    const ciclos = col(cor ? 'ciclos' : `x${slug}_ciclos`);
    const plans = {};
    if (cor) plans['2026'] = '2026-08-28';
    for (const [y, v] of Object.entries(ciclos)) plans[y] = (v && v.ini) || '9999-12-31';
    const ordered = Object.keys(plans).sort((a, b) => (plans[a] < plans[b] ? -1 : plans[a] > plans[b] ? 1 : 0));
    const latest = ordered[ordered.length - 1];
    for (const y of ordered) {
      const nm = (b) => (cor ? (y === '2026' ? b : `c${y}_${b}`) : `x${slug}_${y}_${b}`);
      const AV = col(nm('avance')), EQ = col(nm('equipos'));
      const items = [];
      if (cor && y === '2026') {
        seed().forEach((b, i) => { const id = 'e' + String(i + 1).padStart(3, '0'); const o = EQ[id]; if (o && o.del) return; items.push({ id, ...b, ...(o || {}) }); });
      }
      for (const [id, o] of Object.entries(EQ)) { if (id[0] === 'n' && o && !o.del && o.d) items.push({ id, s: 'P', ...o }); }
      for (const it of items) {
        const a = AV[it.id];
        const s = a ? a.s : (it.s || 'P');
        const prog = (a && a.prog) || it.d;
        out.push({
          c: slug, cn: cl.n || slug, plan: y, latest: y === latest, id: it.id, u: it.u || '', l: it.l || '', m: it.m || '', sn: it.sn || '',
          s: s === 'L' || s === 'R' ? s : 'P', prog: isDate(prog) ? prog : null,
          ejec: a && isDate(a.ejec) ? a.ejec : null, by: (a && a.by) || '', prox: a && isDate(a.prox) ? a.prox : null,
          hi: (a && a.hi) || '', hf: (a && a.hf) || '', min: a ? totalMin(a) : null
        });
      }
    }
  }
  return out;
}

function stats(rows, hoy) {
  const t = rows.length, L = rows.filter((r) => r.s === 'L'), R = rows.filter((r) => r.s === 'R').length;
  const conF = L.filter((r) => r.ejec && r.prog), aT = conF.filter((r) => r.ejec <= r.prog).length;
  const conH = L.filter((r) => r.min != null), mt = conH.reduce((a, r) => a + r.min, 0);
  return {
    total: t, listos: L.length, espera: R, pendientes: t - L.length - R, avance: pc(L.length, t),
    atrasados: rows.filter((r) => r.s !== 'L' && r.prog && r.prog < hoy).length,
    vencidos: rows.filter((r) => r.latest && r.s === 'L' && r.prox && r.prox < hoy).length,
    aTiempo: aT, conFecha: conF.length, puntualidad: pc(aT, conF.length),
    conHoras: conH.length, horas: r2(mt / 60), promHoras: conH.length ? r2(mt / 60 / conH.length) : 0
  };
}

function report(col, users, q) {
  const hoy = todayStr();
  const from = isDate(q.from) ? q.from : '', to = isDate(q.to) ? q.to : '';
  const g = ['day', 'week', 'month'].includes(q.g) ? q.g : 'month';
  const sel = q.c && q.c !== 'all' ? q.c : '';
  let rows = collect(col);
  if (sel) rows = rows.filter((r) => r.c === sel);
  if (from || to) rows = rows.filter((r) => { const d = r.ejec || r.prog; if (!d) return false; return (!from || d >= from) && (!to || d <= to); });

  const global = stats(rows, hoy);
  const byCli = {}; rows.forEach((r) => (byCli[r.c] = byCli[r.c] || { c: r.c, n: r.cn, rows: [] }).rows.push(r));
  const clientes = Object.values(byCli).map((x) => ({ c: x.c, n: x.n, ...stats(x.rows, hoy) })).sort((a, b) => a.n.localeCompare(b.n, 'es'));

  const done = rows.filter((r) => r.s === 'L');
  const byCol = {}; done.forEach((r) => { const k = r.by || 'Sin asignar'; (byCol[k] = byCol[k] || []).push(r); });
  const colabs = Object.entries(byCol).map(([n, rs]) => {
    const conH = rs.filter((r) => r.min != null), mt = conH.reduce((a, r) => a + r.min, 0);
    const conF = rs.filter((r) => r.ejec && r.prog), aT = conF.filter((r) => r.ejec <= r.prog).length;
    const fechas = rs.map((r) => r.ejec).filter(Boolean).sort();
    return {
      n, listos: rs.length, conHoras: conH.length, horas: r2(mt / 60), promHoras: conH.length ? r2(mt / 60 / conH.length) : 0,
      eqHora: mt ? r2(conH.length / (mt / 60)) : 0, aTiempo: aT, conFecha: conF.length, puntualidad: pc(aT, conF.length),
      desde: fechas[0] || '', hasta: fechas[fechas.length - 1] || ''
    };
  }).sort((a, b) => b.listos - a.listos || a.n.localeCompare(b.n, 'es'));

  const keys = new Set(), series = {};
  done.forEach((r) => { if (!r.ejec) return; const k = periodKey(r.ejec, g), n = r.by || 'Sin asignar'; keys.add(k); (series[n] = series[n] || {})[k] = (series[n][k] || 0) + 1; });
  const periodos = { g, keys: [...keys].sort(), series };

  const bySer = {};
  done.forEach((r) => { const k = r.c + '|' + (r.sn || r.id + '|' + r.plan); (bySer[k] = bySer[k] || []).push(r); });
  const equipos = Object.values(bySer).map((rs) => {
    const f = rs[0], conH = rs.filter((r) => r.min != null), mt = conH.reduce((a, r) => a + r.min, 0);
    const last = rs.slice().sort((a, b) => ((b.ejec || '') > (a.ejec || '') ? 1 : -1))[0];
    return { cn: f.cn, u: f.u, l: f.l, m: f.m, sn: f.sn, serv: rs.length, conHoras: conH.length, horas: r2(mt / 60), ultima: last.ejec || '', por: last.by || '' };
  }).sort((a, b) => b.horas - a.horas || a.cn.localeCompare(b.cn, 'es') || a.u.localeCompare(b.u, 'es'));

  const det = done.slice().sort((a, b) => ((b.ejec || '') > (a.ejec || '') ? 1 : (b.ejec || '') < (a.ejec || '') ? -1 : 0)).map((r) => ({
    cn: r.cn, plan: r.plan, u: r.u, l: r.l, m: r.m, sn: r.sn, prog: r.prog || '', ejec: r.ejec || '', by: r.by || '', hi: r.hi, hf: r.hf, horas: r.min != null ? r2(r.min / 60) : null
  }));
  const lista = Object.entries(col('clientes')).map(([c, v]) => ({ c, n: (v && v.n) || c }));
  return { hoy, filtro: { c: sel || 'all', from, to, g }, global, clientes, colabs, periodos, equipos, det, lista };
}

/* ---------- xlsx mínimo ---------- */
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (b) => { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
function zip(files) {
  const loc = [], cen = []; let off = 0;
  for (const [name, content] of files) {
    const nb = Buffer.from(name), raw = Buffer.from(content), def = zlib.deflateRawSync(raw), crc = crc32(raw);
    const h = Buffer.alloc(30); h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(0x0800, 6); h.writeUInt16LE(8, 8); h.writeUInt32LE(0x21000000, 10); h.writeUInt32LE(crc, 14); h.writeUInt32LE(def.length, 18); h.writeUInt32LE(raw.length, 22); h.writeUInt16LE(nb.length, 26);
    loc.push(h, nb, def);
    const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0800, 8); c.writeUInt16LE(8, 10); c.writeUInt32LE(0x21000000, 12); c.writeUInt32LE(crc, 16); c.writeUInt32LE(def.length, 20); c.writeUInt32LE(raw.length, 24); c.writeUInt16LE(nb.length, 28); c.writeUInt32LE(off, 42);
    cen.push(c, nb); off += 30 + nb.length + def.length;
  }
  const cb = Buffer.concat(cen), e = Buffer.alloc(22); e.writeUInt32LE(0x06054b50, 0); e.writeUInt16LE(files.length, 8); e.writeUInt16LE(files.length, 10); e.writeUInt32LE(cb.length, 12); e.writeUInt32LE(off, 16);
  return Buffer.concat([...loc, cb, e]);
}
const xe = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
const colL = (i) => { let s = ''; for (i++; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s; return s; };
/* celda: {v, st}  st: 1 encabezado, 2 decimal, 3 título */
function sheetXml(rows, widths) {
  const body = rows.map((row, ri) => `<row r="${ri + 1}">` + row.map((c, ci) => {
    if (c == null || c === '') return '';
    const o = typeof c === 'object' ? c : { v: c }; const ref = colL(ci) + (ri + 1), st = o.st ? ` s="${o.st}"` : '';
    return typeof o.v === 'number' && isFinite(o.v) ? `<c r="${ref}"${st}><v>${o.v}</v></c>` : `<c r="${ref}"${st} t="inlineStr"><is><t xml:space="preserve">${xe(o.v)}</t></is></c>`;
  }).join('') + '</row>').join('');
  const cols = widths ? '<cols>' + widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('') + '</cols>' : '';
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"/></sheetViews>${cols}<sheetData>${body}</sheetData></worksheet>`;
}
function xlsx(sheets) {
  const H = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
  const files = [
    ['[Content_Types].xml', H + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' + sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('') + '</Types>'],
    ['_rels/.rels', H + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
    ['xl/workbook.xml', H + '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' + sheets.map((s, i) => `<sheet name="${xe(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('') + '</sheets></workbook>'],
    ['xl/_rels/workbook.xml.rels', H + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('') + `<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`],
    ['xl/styles.xml', H + '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="0.00"/></numFmts><fonts count="3"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font><font><b/><sz val="14"/><color rgb="FF0B3C7D"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF0B3C7D"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs></styleSheet>'],
    ...sheets.map((s, i) => [`xl/worksheets/sheet${i + 1}.xml`, sheetXml(s.rows, s.widths)])
  ];
  return zip(files);
}
const hd = (a) => a.map((v) => ({ v, st: 1 }));
const d2 = (v) => (v == null ? '' : { v, st: 2 });

function workbook(rep, emitido, por) {
  const f = rep.filtro, g = rep.global;
  const cliN = f.c === 'all' ? 'Todos los clientes' : ((rep.lista.find((x) => x.c === f.c) || {}).n || f.c);
  const resumen = [
    [{ v: 'Panel gerencial · mttos.pbs', st: 3 }], [],
    ['Cliente', cliN], ['Desde', f.from || 'Inicio'], ['Hasta', f.to || 'Hoy'], ['Emitido', emitido], ['Emitido por', por], [],
    hd(['Indicador', 'Valor']),
    ['Equipos', g.total], ['Listos', g.listos], ['En espera de repuesto', g.espera], ['Pendientes', g.pendientes], ['Avance %', g.avance],
    ['Puntualidad % (atendidos en o antes de la fecha programada)', g.puntualidad], ['Atrasados (pendientes con fecha vencida)', g.atrasados],
    ['Próximos servicios vencidos', g.vencidos], ['Equipos con horas registradas', g.conHoras], ['Horas totales de trabajo', d2(g.horas)], ['Promedio de horas por equipo', d2(g.promHoras)]
  ];
  const clientes = [hd(['Cliente', 'Equipos', 'Listos', 'Espera repuesto', 'Pendientes', 'Avance %', 'Puntualidad %', 'Atrasados', 'Servicios vencidos', 'Horas totales', 'Horas prom. por equipo']),
    ...rep.clientes.map((c) => [c.n, c.total, c.listos, c.espera, c.pendientes, c.avance, c.puntualidad, c.atrasados, c.vencidos, d2(c.horas), d2(c.promHoras)])];
  const colabs = [hd(['Colaborador', 'Equipos listos', 'Con horas', 'Horas totales', 'Horas prom. por equipo', 'Equipos por hora', 'Puntualidad %', 'Primer servicio', 'Último servicio']),
    ...rep.colabs.map((c) => [c.n, c.listos, c.conHoras, d2(c.horas), d2(c.promHoras), d2(c.eqHora), c.puntualidad, c.desde, c.hasta])];
  const pk = rep.periodos.keys, gl = { day: 'Día', week: 'Semana (lunes)', month: 'Mes' }[rep.periodos.g];
  const periodos = [hd([`Colaborador \\ ${gl}`, ...pk, 'Total']),
    ...Object.entries(rep.periodos.series).map(([n, s]) => [n, ...pk.map((k) => s[k] || 0), pk.reduce((a, k) => a + (s[k] || 0), 0)])];
  const equipos = [hd(['Cliente', 'Equipo / ubicación', 'Localidad', 'Modelo', 'Serie', 'Servicios', 'Con horas', 'Horas totales', 'Último servicio', 'Registrado por']),
    ...rep.equipos.map((e) => [e.cn, e.u, e.l, e.m, e.sn || 'sin serie', e.serv, e.conHoras, d2(e.horas), e.ultima, e.por])];
  const det = [hd(['Cliente', 'Plan', 'Equipo / ubicación', 'Localidad', 'Modelo', 'Serie', 'Programada', 'Ejecución', 'Colaborador', 'Llegada', 'Salida', 'Horas']),
    ...rep.det.map((r) => [r.cn, r.plan, r.u, r.l, r.m, r.sn || 'sin serie', r.prog, r.ejec, r.by || 'Sin asignar', r.hi, r.hf, d2(r.horas)])];
  return xlsx([
    { name: 'Resumen', rows: resumen, widths: [58, 24] },
    { name: 'Clientes', rows: clientes, widths: [26, 10, 10, 15, 12, 10, 13, 10, 17, 13, 20] },
    { name: 'Colaboradores', rows: colabs, widths: [26, 14, 11, 13, 20, 16, 14, 16, 16] },
    { name: 'Por periodo', rows: periodos, widths: [28] },
    { name: 'Horas por equipo', rows: equipos, widths: [22, 44, 22, 30, 18, 10, 11, 14, 15, 20] },
    { name: 'Detalle', rows: det, widths: [22, 8, 44, 22, 30, 18, 12, 12, 22, 9, 9, 9] }
  ]);
}
module.exports = { report, workbook };
