/**
 * Confere o TabSis contra o TabWin 4.15 real no SIM (DOAC2024) e no SINASC
 * (DNAC2022), com os DEF e CNV oficiais (captura de 2026-10-14).
 *
 * Uso: node scripts/verify-sim-sinasc.mjs <pasta SIM: DOAC2024.dbc + CNVs> <pasta SINASC: DNAC2022.dbc + CNVs>
 */
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { dbcToDbf, readDbfHeader, readDbfRecords } from '@precisa-saude/datasus-dbc';
import { parseCnv, parseDef } from '../dist/packages/formats/src/index.js';
import { compileQueryPlan, executeInMemory, withRecordLayout } from '../dist/packages/core/src/index.js';
import { calculateColumnTotal } from '../dist/packages/analysis/src/table-operations.js';

const dirs = { SIM: process.argv[2], SINASC: process.argv[3] };
if (!dirs.SIM || !dirs.SINASC) throw new Error('uso: node scripts/verify-sim-sinasc.mjs <pasta-SIM> <pasta-SINASC>');
const expected = JSON.parse(await readFile(new URL('../fixtures/oracle/re003-sim-sinasc/expected.json', import.meta.url), 'utf8'));
const cp1252 = new TextDecoder('windows-1252');
let failures = 0; let count = 0;
for (const source of expected.sources) {
  const dir = dirs[source.name];
  const files = new Map(); for (const name of await readdir(dir)) files.set(name.toUpperCase(), path.join(dir, name));
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
    const spec = withRecordLayout({
      compatibilityProfile: 'tabwin-4.15',
      rows: { field: option.field.toUpperCase(), conversionId: base, startPosition: option.startPosition, unclassifiedPolicy: 'discriminate' },
      measure: { kind: 'count' }, filters: [],
    }, layout, conversions);
    const result = executeInMemory(records, compileQueryPlan(spec), conversions);
    const got = result.rows.map((row, i) => [row.label, result.cells[i][0]]);
    const total = calculateColumnTotal(result, result.columns[0].key, 'sum');
    if (JSON.stringify(got) === JSON.stringify(c.rows) && total === c.total) console.log(`ok ${source.name} ${c.id} ${c.linha}${spec.rows.recordSpan ? ` (lê ${spec.rows.recordSpan.map((f) => f.field).join('+')})` : ''}`);
    else {
      failures++;
      console.log(`FALHOU ${source.name} ${c.id} ${c.linha} — total TabWin ${c.total}, TabSis ${total}`);
      const want = new Map(c.rows); const have = new Map(got);
      let shown = 0;
      for (const label of new Set([...want.keys(), ...have.keys()])) {
        if (want.get(label) !== have.get(label) && shown++ < 8) console.log(`   ${label}: TabWin ${want.get(label) ?? '—'}, TabSis ${have.get(label) ?? '—'}`);
      }
      if (want.size === have.size && JSON.stringify([...want.keys()]) !== JSON.stringify([...have.keys()]) && !shown) console.log('   mesma contagem, ordem diferente');
    }
  }
}
console.log(`sim-sinasc: ${count - failures}/${count} casos iguais ao TabWin 4.15`);
if (failures) process.exitCode = 1;
