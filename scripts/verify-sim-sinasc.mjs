/**
 * Confere o TabSis contra o TabWin 4.15 real no SIM (DOAC2024) e no SINASC
 * (DNAC2022), com os DEF e CNV oficiais (captura de 2026-10-14).
 *
 * Também SIA (PAAC2501, com G e Valor Aprovado), SINAN (HANSBR23) e CNES
 * (STAC2501 e LTAC2501, com G QT_EXIST; RE-004).
 *
 * Uso: node scripts/verify-sim-sinasc.mjs SIM=<pasta> SINASC=<pasta> [SIA=<pasta>] [SINAN=<pasta>] [CNES=<pasta>]
 * (cada pasta com o .dbc e as CNV, nela ou em CNV\, DADOS\). Sistema sem pasta fica de fora.
 */
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { dbcToDbf, readDbfHeader, readDbfRecords } from '@precisa-saude/datasus-dbc';
import { parseCnv, parseDef } from '../dist/packages/formats/src/index.js';
import { compileQueryPlan, executeInMemory, withRecordLayout } from '../dist/packages/core/src/index.js';
import { calculateColumnTotal } from '../dist/packages/analysis/src/table-operations.js';

const dirs = Object.fromEntries(process.argv.slice(2).map((arg) => arg.split(/=(.*)/s).slice(0, 2)));
if (!Object.keys(dirs).length) throw new Error('uso: node scripts/verify-sim-sinasc.mjs SIM=<pasta> SINASC=<pasta> [SIA=<pasta>] [SINAN=<pasta>] [CNES=<pasta>]');
const expected = JSON.parse(await readFile(new URL('../fixtures/oracle/re003-sim-sinasc/expected.json', import.meta.url), 'utf8'));
const cp1252 = new TextDecoder('windows-1252');
let failures = 0; let count = 0; let known = 0;
for (const source of expected.sources) {
  const dir = dirs[source.name];
  if (!dir) { console.log(`(sem pasta para ${source.name})`); continue; }
  const files = new Map();
  // A pasta e as subpastas diretas (CNV, DADOS; no CNES, ESTABEL e LEITO).
  const subfolders = (await readdir(dir, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => path.join(dir, entry.name));
  for (const folder of [dir, ...subfolders]) {
    try { for (const name of await readdir(folder)) files.set(name.toUpperCase(), path.join(folder, name)); } catch { /* opcional */ }
  }
  const def = parseDef(source.defText);
  const dbf = dbcToDbf(new Uint8Array(await readFile(files.get(source.data.toUpperCase()))));
  const layout = readDbfHeader(dbf).fields.map((f) => ({ field: f.name, type: f.type, length: f.length, decimals: f.decimalCount }));
  const records = []; for await (const record of readDbfRecords(dbf)) records.push(record);
  for (const c of source.cases) {
    count++;
    const option = def.options.find((candidate) => candidate.label === c.linha && candidate.roles.includes('row'));
    const base = path.basename(option.conversionFile.replace(/\\/g, '/')).toUpperCase();
    let conversions;
    try { conversions = { [base]: parseCnv(cp1252.decode(await readFile(files.get(base)))) }; }
    catch (error) { failures++; console.log(`FALHOU ${c.id} ${c.linha}: o TabSis não lê ${base} (${error.message})`); continue; }
    // Freqüência (contagem, ou a soma do campo G) e os incrementos do log.
    const frequency = { kind: 'count', ...(def.groupedCountField ? { weightField: def.groupedCountField.toUpperCase() } : {}) };
    const measures = c.incrementos.map((label) => {
      if (label === 'Freqüência') return frequency;
      const increment = def.increments.find((candidate) => candidate.label === label);
      return { kind: 'sum', field: increment.field.toUpperCase(), label };
    });
    const spec = withRecordLayout({
      compatibilityProfile: 'tabwin-4.15',
      rows: { field: option.field.toUpperCase(), conversionId: base, startPosition: option.startPosition, unclassifiedPolicy: 'discriminate' },
      measure: measures[0], ...(measures.length > 1 ? { measures } : {}), filters: [],
    }, layout, conversions);
    const result = executeInMemory(records, compileQueryPlan(spec), conversions);
    const round = (value) => Math.round(value * 100) / 100;
    const got = result.rows.map((row, i) => [row.label, ...result.cells[i].map(round)]);
    const total = result.columns.map((column) => round(calculateColumnTotal(result, column.key, 'sum')));
    if (JSON.stringify(got) === JSON.stringify(c.rows) && JSON.stringify(total) === JSON.stringify(c.total)) console.log(`ok ${source.name} ${c.id} ${c.linha}${spec.rows.recordSpan ? ` (lê ${spec.rows.recordSpan.map((f) => f.field).join('+')})` : ''}`);
    else if (c.knownDifference) {
      known++;
      console.log(`DIFERENÇA CONHECIDA ${source.name} ${c.id} ${c.linha}: ${c.knownDifference}`);
    } else {
      failures++;
      console.log(`FALHOU ${source.name} ${c.id} ${c.linha} — total TabWin ${c.total}, TabSis ${total}`);
      const want = new Map(c.rows.map(([label, ...values]) => [label, values.join(' | ')]));
      const have = new Map(got.map(([label, ...values]) => [label, values.join(' | ')]));
      let shown = 0;
      for (const label of new Set([...want.keys(), ...have.keys()])) {
        if (want.get(label) !== have.get(label) && shown++ < 8) console.log(`   ${label}: TabWin ${want.get(label) ?? '—'}, TabSis ${have.get(label) ?? '—'}`);
      }
      if (want.size === have.size && JSON.stringify([...want.keys()]) !== JSON.stringify([...have.keys()]) && !shown) console.log('   mesma contagem, ordem diferente');
    }
  }
}
console.log(`sim-sinasc: ${count - failures - known}/${count} casos iguais ao TabWin 4.15${known ? `, ${known} diferença(s) conhecida(s) e documentada(s)` : ''}`);
if (failures) process.exitCode = 1;
