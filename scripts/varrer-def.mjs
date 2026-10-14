/**
 * Varredura de um DEF oficial: para cada variável com CNV, compara a leitura
 * por texto (a antiga) com a do motor atual (código curto como número, branco,
 * campos atravessados) num arquivo de dados, e lista onde dão categorias
 * diferentes. É o que aponta quais variáveis vale tabular no TabWin para
 * conferir (RE-003: SIH, SIM, SINASC).
 *
 * Uso (depois de npm run build): node scripts/varrer-def.mjs <arquivo.def> <pasta das CNV> <dados.dbc>
 */
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { dbcToDbf, readDbfHeader, readDbfRecords } from '@precisa-saude/datasus-dbc';
import { parseCnv, parseDef } from '../dist/packages/formats/src/index.js';
import { resolveDimensionValue, withRecordLayout } from '../dist/packages/core/src/index.js';
const [defPath, cnvDir, dbcPath] = process.argv.slice(2);
const cp = new TextDecoder('windows-1252');
const files = new Map(); for (const f of await readdir(cnvDir)) files.set(f.toUpperCase(), path.join(cnvDir, f));
const def = parseDef(cp.decode(await readFile(defPath)));
const dbf = dbcToDbf(new Uint8Array(await readFile(dbcPath)));
const header = readDbfHeader(dbf);
const layout = header.fields.map((f) => ({ field: f.name, type: f.type, length: f.length, decimals: f.decimalCount }));
const fieldNames = new Set(layout.map((f) => f.field));
const records = []; for await (const r of readDbfRecords(dbf)) records.push(r);
const old = (cnv, raw) => { const code = raw == null ? '' : String(raw).slice(0, cnv.codeLength); if (!code) return undefined;
  const rules = cnv.precedence === 'first-match-wins' ? cnv.rules : [...cnv.rules].reverse();
  const m = rules.find((r) => r.exactCodes.includes(code) || r.ranges.some((g) => code >= g.from && code <= g.to));
  return m ? cnv.categories.find((c) => c.sequence === m.categorySequence)?.label : undefined; };
const seen = new Set(); let total = 0, missing = 0;
for (const o of def.options) {
  if (o.kind !== 'conversion') continue;
  const key = `${o.field}|${o.startPosition}|${o.conversionFile.toUpperCase()}`; if (seen.has(key)) continue; seen.add(key); total++;
  const file = files.get(path.basename(o.conversionFile.replace(/\\/g, '/')).toUpperCase());
  if (!file || !fieldNames.has(o.field.toUpperCase())) { missing++; continue; }
  let cnv; try { cnv = parseCnv(cp.decode(await readFile(file)), { strict: false }); } catch (e) { console.log('ERRO CNV', o.conversionFile, e.message); continue; }
  const field = o.field.toUpperCase();
  const spec = withRecordLayout({ compatibilityProfile: 'tabwin-4.15', rows: { field, conversionId: 'X', startPosition: o.startPosition }, measure: { kind: 'count' }, filters: [] }, layout, { X: cnv });
  let diff = 0; const ex = new Map();
  for (const r of records) {
    const raw = r[field]; const start = (o.startPosition ?? 1) - 1;
    const v = raw == null ? raw : typeof raw === 'number' ? raw : String(raw).slice(start, start + cnv.codeLength);
    const a = cnv.mode === 'numeric-ranges' ? 'n/a' : old(cnv, typeof v === 'number' ? String(v) : v);
    const b = resolveDimensionValue(r, spec.rows, { X: cnv }).label;
    if (cnv.mode !== 'numeric-ranges' && a !== b) { diff++; const k = `${JSON.stringify(raw)}: ${a ?? 'NC'} -> ${b ?? 'NC'}`; ex.set(k, (ex.get(k) ?? 0) + 1); }
  }
  if (diff) console.log(`${o.label.trim()} [${field},${o.startPosition},${o.conversionFile}] ${cnv.mode}/${cnv.codeLength}${spec.rows.recordSpan ? ' span=' + spec.rows.recordSpan.map((f) => f.field).join('+') : ''} diff=${diff}`, [...ex].sort((x, y) => y[1] - x[1]).slice(0, 4));
}
console.log('records', records.length, 'opções únicas', total, 'sem CNV/campo', missing);
