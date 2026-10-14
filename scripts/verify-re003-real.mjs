/**
 * Confere o TabSis contra o TabWin 4.15 real em variáveis do RD2008.DEF cujo
 * código atravessa para o campo vizinho ou tem CID de 3 caracteres numa CNV de
 * 4 (RE-003, captura de 2026-10-14).
 *
 * Uso: node scripts/verify-re003-real.mjs <pasta com RDAC2401.dbc e a pasta CNV do SIH>
 * (depois de `npm run build`). O esperado está em fixtures/oracle/re003-rdac2401/.
 */
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { dbcToDbf, readDbfHeader, readDbfRecords } from '@precisa-saude/datasus-dbc';
import { parseCnv, parseDef } from '../dist/packages/formats/src/index.js';
import { compileQueryPlan, executeInMemory, withRecordLayout } from '../dist/packages/core/src/index.js';

const dir = process.argv[2];
if (!dir) throw new Error('uso: node scripts/verify-re003-real.mjs <pasta-dos-ativos>');
const expected = JSON.parse(await readFile(new URL('../fixtures/oracle/re003-rdac2401/expected.json', import.meta.url), 'utf8'));
const cp1252 = new TextDecoder('windows-1252');
const cnvFiles = new Map();
for (const folder of [dir, path.join(dir, 'CNV')]) {
  try { for (const name of await readdir(folder)) cnvFiles.set(name.toUpperCase(), path.join(folder, name)); } catch { /* pasta opcional */ }
}
const def = parseDef(expected.defText);
const dbf = dbcToDbf(new Uint8Array(await readFile(path.join(dir, 'RDAC2401.dbc'))));
const layout = readDbfHeader(dbf).fields.map((field) => ({ field: field.name, type: field.type, length: field.length, decimals: field.decimalCount }));
const records = [];
for await (const record of readDbfRecords(dbf)) records.push(record);

let failures = 0;
for (const c of expected.cases) {
  const option = def.options.find((candidate) => candidate.label === c.linha);
  assert.ok(option, c.linha);
  const base = path.basename(option.conversionFile.replace(/\\/g, '/')).toUpperCase();
  const conversions = { [base]: parseCnv(cp1252.decode(await readFile(cnvFiles.get(base))), { strict: false }) };
  const spec = withRecordLayout({
    compatibilityProfile: 'tabwin-4.15',
    rows: { field: option.field, conversionId: base, startPosition: option.startPosition, unclassifiedPolicy: 'discriminate' },
    measure: { kind: 'count' },
    filters: [],
  }, layout, conversions);
  const result = executeInMemory(records, compileQueryPlan(spec), conversions);
  const got = result.rows.map((row, index) => [row.label, result.cells[index][0]]);
  const want = c.rows.filter(([, count]) => count !== 0);
  const gotNonZero = got.filter(([, count]) => count !== 0);
  const same = JSON.stringify(gotNonZero) === JSON.stringify(want);
  if (same) console.log(`ok ${c.id} ${c.linha}${spec.rows.recordSpan ? ` (lê ${spec.rows.recordSpan.map((f) => f.field).join('+')})` : ''}`);
  else {
    failures++;
    console.log(`FALHOU ${c.id} ${c.linha}`);
    const wantMap = new Map(want); const gotMap = new Map(gotNonZero);
    for (const label of new Set([...wantMap.keys(), ...gotMap.keys()])) {
      if (wantMap.get(label) !== gotMap.get(label)) console.log(`   ${label}: TabWin ${wantMap.get(label) ?? 0}, TabSis ${gotMap.get(label) ?? 0}`);
    }
  }
}
console.log(`re003: ${expected.cases.length - failures}/${expected.cases.length} casos iguais ao TabWin 4.15`);
if (failures) process.exitCode = 1;
