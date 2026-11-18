'use strict';
/*
 * Reporte de Horas Extras en el formato oficial (Formato_Horas_Extras_Limpio).
 * Se parte de la plantilla real (he-form-tpl.js, con logo, estilos, bordes, anchos y firmas) y solo se rellenan sus celdas:
 *   - Encabezado: Nombre de Empleado (E9), Código (E10), Departamento (E11), Mes (E12).
 *   - 7 filas de registro (17 a 23): Fecha, Mañana/Tarde/Noche (ingreso y salida), Diurnas/Nocturna/Dobles,
 *     Descripción de Trabajo y Horas de viaje. La fila 24 conserva sus fórmulas de TOTAL HORAS.
 * Si un colaborador tiene más de 7 registros, se agregan hojas idénticas (misma plantilla), cada una con su propio total.
 * Sin dependencias: usa zlib de Node y el zip de reports.js.
 */
const zlib = require('zlib');
const { zip } = require('./reports');

const TPL = JSON.parse(zlib.inflateSync(Buffer.from(require('./he-form-tpl'), 'base64')).toString('utf8'));
const part = (n) => (TPL[n].t === 'b' ? Buffer.from(TPL[n].d, 'base64') : TPL[n].d);
const SHEET = part('xl/worksheets/sheet1.xml');
const ROWS = [17, 18, 19, 20, 21, 22, 23];          // filas de datos de la plantilla
const PER_PAGE = ROWS.length;
const CHARS_LINE = 34;                               // caracteres por línea en la columna "Descripción de Trabajo"
const LINE_PT = 12.75;

const r2 = (x) => Math.round(x * 100) / 100;
const esc = (s) => String(s == null ? '' : s).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const toMin = (h) => +h.slice(0, 2) * 60 + +h.slice(3, 5);
const serial = (ymd) => Math.round((Date.UTC(+ymd.slice(0, 4), +ymd.slice(5, 7) - 1, +ymd.slice(8, 10)) - Date.UTC(1899, 11, 30)) / 86400000);

/* ---------- turnos: Mañana 5:00–12:00, Tarde 12:00–19:00, Noche 19:00–5:00 ---------- */
const WIN = [['n', 0, 300], ['m', 300, 720], ['t', 720, 1140], ['n', 1140, 1740], ['m', 1740, 2160], ['t', 2160, 2580], ['n', 2580, 2880]];
function shiftRows(hi, hf) {
  const a = toMin(hi); let b = toMin(hf); if (b <= a) b += 1440;
  const rows = []; let cur = {};
  for (const [k, s, e] of WIN) {
    const x = Math.max(a, s), y = Math.min(b, e); if (y <= x) continue;
    if (cur[k]) { rows.push(cur); cur = {}; }            // el mismo turno dos veces (muy largo): continúa en otra fila
    cur[k] = [x % 1440, y % 1440];
  }
  if (Object.keys(cur).length) rows.push(cur);
  return rows;
}

/* ---------- edición de celdas sobre el XML de la plantilla ---------- */
const cellRe = (ref) => new RegExp('<c r="' + ref + '"( s="\\d+")?\\s*/>');
function put(x, ref, inner, type) {
  const re = cellRe(ref); const m = x.match(re); if (!m) throw new Error('Celda no encontrada en la plantilla: ' + ref);
  return x.replace(re, `<c r="${ref}"${m[1] || ''}${type ? ' t="' + type + '"' : ''}>${inner}</c>`);
}
const setNum = (x, ref, n) => (n == null || !isFinite(n) ? x : put(x, ref, `<v>${n}</v>`));
const setStr = (x, ref, s) => (s == null || String(s).trim() === '' ? x : put(x, ref, `<is><t xml:space="preserve">${esc(s)}</t></is>`, 'inlineStr'));
// +1e-9 día (≈ 0.09 ms): evita que algunos programas muestren 18:59 por redondeo al truncar los segundos
const setTime = (x, ref, min) => (min == null ? x : setNum(x, ref, +(min / 1440 + 1e-9).toFixed(12)));
function setCached(x, ref, n) { return x.replace(new RegExp('(<c r="' + ref + '"[^>]*><f[^>]*>[^<]*</f>)<v>[^<]*</v>'), `$1<v>${n}</v>`); }
function setHeight(x, r, ht) {
  return x.replace(new RegExp('<row r="' + r + '"[^>]*>'), (tag) => tag.replace(/ ht="[\d.]+"/, ` ht="${ht}"`).replace(/customHeight="(true|false)"/, 'customHeight="true"'));
}
const baseHeight = (r) => { const m = SHEET.match(new RegExp('<row r="' + r + '"[^>]*? ht="([\\d.]+)"')); return m ? +m[1] : 13; };
function lines(text) {
  let n = 0;
  for (const para of String(text || '').split('\n')) {
    let len = 0, l = 1;
    for (const w of para.split(' ')) {
      if (len && len + 1 + w.length > CHARS_LINE) { l++; len = w.length; while (len > CHARS_LINE) { l++; len -= CHARS_LINE; } }
      else { len += (len ? 1 : 0) + w.length; while (len > CHARS_LINE) { l++; len -= CHARS_LINE; } }
    }
    n += l;
  }
  return n || 1;
}

/* ---------- una hoja del formato ---------- */
function sheetXml(page, first) {
  let x = SHEET;
  x = setStr(x, 'E9', page.nombre); x = setStr(x, 'E10', page.cod); x = setStr(x, 'E11', page.dep); x = setStr(x, 'E12', page.mes);
  const tot = { d: 0, n: 0, x: 0 };
  page.rows.forEach((r, i) => {
    const n = ROWS[i];
    x = setNum(x, 'C' + n, serial(r.f));
    x = setTime(x, 'D' + n, r.m && r.m[0]); x = setTime(x, 'E' + n, r.m && r.m[1]);
    x = setTime(x, 'F' + n, r.t && r.t[0]); x = setTime(x, 'G' + n, r.t && r.t[1]);
    x = setTime(x, 'H' + n, r.nn && r.nn[0]); x = setTime(x, 'I' + n, r.nn && r.nn[1]);
    if (r.d > 0) x = setNum(x, 'J' + n, r2(r.d)); if (r.n > 0) x = setNum(x, 'K' + n, r2(r.n)); if (r.x > 0) x = setNum(x, 'L' + n, r2(r.x));
    x = setStr(x, 'M' + n, r.desc);
    if (r.v > 0) x = setNum(x, 'N' + n, r2(r.v));
    tot.d += r.d || 0; tot.n += r.n || 0; tot.x += r.x || 0;
    const need = Math.ceil(lines(r.desc) * LINE_PT + 3);
    if (need > baseHeight(n)) x = setHeight(x, n, need);   // solo crece si el texto no cabe; nunca se achica la fila de la plantilla
  });
  x = setCached(x, 'J24', r2(tot.d)); x = setCached(x, 'K24', r2(tot.n)); x = setCached(x, 'L24', r2(tot.x)); x = setCached(x, 'M24', r2(tot.d + tot.n + tot.x));
  if (!first) x = x.replace('tabSelected="true"', 'tabSelected="false"');
  return x;
}

const safeName = (s) => String(s || 'Hoja').replace(/[:\\/?*\[\]]/g, ' ').replace(/\s+/g, ' ').trim().replace(/^'+|'+$/g, '') || 'Hoja';

/*
 * emps: [{ nombre, cod, dep, mes, recs: [{ f:'YYYY-MM-DD', hi:'HH:MM', hf:'HH:MM', d, n, x (horas), desc, v (horas de viaje) }] }]
 * Devuelve el .xlsx (Buffer). Una o varias hojas por colaborador (7 registros por hoja).
 */
function buildWorkbook(emps) {
  const pages = [];
  for (const e of emps) {
    const rows = [];
    for (const r of e.recs) {
      shiftRows(r.hi, r.hf).forEach((sr, i) => rows.push({ f: r.f, m: sr.m, t: sr.t, nn: sr.n, d: i ? 0 : r.d, n: i ? 0 : r.n, x: i ? 0 : r.x, v: i ? 0 : r.v, desc: i ? '(continuación)' : r.desc }));
    }
    const np = Math.max(1, Math.ceil(rows.length / PER_PAGE));
    for (let p = 0; p < np; p++) pages.push({ nombre: e.nombre, cod: e.cod, dep: e.dep, mes: e.mes + (np > 1 ? ` · Hoja ${p + 1} de ${np}` : ''), base: safeName(e.nombre), p, np, rows: rows.slice(p * PER_PAGE, (p + 1) * PER_PAGE) });
  }
  if (!pages.length) throw new Error('Sin registros');
  const used = new Set();
  pages.forEach((pg) => {
    const suf = pg.p ? ` (${pg.p + 1})` : '';
    let name = (pg.base.slice(0, 31 - suf.length) + suf).trim(), k = 2;
    while (used.has(name.toLowerCase())) { const s2 = ` (${k++})`; name = pg.base.slice(0, 31 - s2.length) + s2; }
    used.add(name.toLowerCase()); pg.name = name;
  });
  const X = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
  const files = [];
  files.push(['[Content_Types].xml', X + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="jpeg" ContentType="image/jpeg"/>' +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
    pages.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/drawings/drawing${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>`).join('') + '</Types>']);
  files.push(['_rels/.rels', X + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>']);
  const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  files.push(['docProps/core.xml', X + `<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>Reporte de Horas Extras</dc:title><dc:creator>Plan de mttos PBS</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created></cp:coreProperties>`]);
  files.push(['xl/workbook.xml', X + '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView activeTab="0"/></bookViews><sheets>' +
    pages.map((pg, i) => `<sheet name="${esc(pg.name)}" sheetId="${i + 1}" r:id="rId${i + 10}"/>`).join('') + '</sheets><definedNames>' +
    pages.map((pg, i) => `<definedName name="_xlnm.Print_Area" localSheetId="${i}">'${esc(pg.name).replace(/'/g, "''")}'!$B$1:$O$40</definedName>`).join('') + '</definedNames><calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>']);
  files.push(['xl/_rels/workbook.xml.rels', X + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="theme/theme1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>' +
    pages.map((_, i) => `<Relationship Id="rId${i + 10}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('') + '</Relationships>']);
  files.push(['xl/styles.xml', part('xl/styles.xml')]);
  files.push(['xl/theme/theme1.xml', part('xl/theme/theme1.xml')]);
  files.push(['xl/sharedStrings.xml', part('xl/sharedStrings.xml')]);
  files.push(['xl/media/image1.jpeg', part('xl/media/image1.jpeg')]);
  pages.forEach((pg, i) => {
    files.push([`xl/worksheets/sheet${i + 1}.xml`, sheetXml(pg, i === 0)]);
    files.push([`xl/worksheets/_rels/sheet${i + 1}.xml.rels`, X + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing${i + 1}.xml"/></Relationships>`]);
    files.push([`xl/drawings/drawing${i + 1}.xml`, part('xl/drawings/drawing1.xml')]);
    files.push([`xl/drawings/_rels/drawing${i + 1}.xml.rels`, part('xl/drawings/_rels/drawing1.xml.rels')]);
  });
  return zip(files);
}

module.exports = { buildWorkbook, shiftRows, PER_PAGE };
