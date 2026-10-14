/**
 * Confere Linha e Seleção por tabela DBF relacionada (DEF `L/S…,CNES,NOMEFANT,DBF\X.DBF`)
 * contra o TabWin 4.15 real (captura de 2026-10-14), montando a consulta pelo
 * painel, como o app.
 *
 * Uso: node scripts/verify-dbf-lookup.mjs <pasta com RDAC2401.dbc, SEXO.CNV e DBF/TCNESAC.DBF, DBF/HUF_MEC.DBF>
 */
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { dbcToDbf, readDbfHeader, readDbfRecords } from '@precisa-saude/datasus-dbc';
import { detectDbfTextEncoding, parseCnv, parseDef, transcodeDbfCp850ToWindows1252 } from '../dist/packages/formats/src/index.js';
import {
  catalogoDoDef, categoriasDoEixo, compileQueryPlan, estadoInicial, executeInMemory, lookupDefinitionFromDefOption,
  nomeBaseDoRecurso, specDoPainel, withRecordLayout,
} from '../dist/packages/core/src/index.js';

const dir = process.argv[2];
if (!dir) throw new Error('uso: node scripts/verify-dbf-lookup.mjs <pasta-dos-ativos>');
const expected = JSON.parse(await readFile(new URL('../fixtures/oracle/re003-dbf-lookup/expected.json', import.meta.url), 'utf8'));
const cp1252 = new TextDecoder('windows-1252');
const files = new Map();
for (const folder of [dir, path.join(dir, 'DBF'), path.join(dir, 'CNV')]) {
  try { for (const name of await readdir(folder)) files.set(name.toLowerCase(), path.join(folder, name)); } catch { /* opcional */ }
}
const def = parseDef(expected.defText);
const cnvs = new Map([['SEXO.CNV', parseCnv(cp1252.decode(await readFile(files.get('sexo.cnv'))))]]);
const lookups = new Map();
for (const option of def.options.filter((candidate) => candidate.kind === 'dbf-lookup')) {
  const name = nomeBaseDoRecurso(option.lookupFile);
  if (lookups.has(name)) continue;
  let bytes = new Uint8Array(await readFile(files.get(name)));
  // Como o app: DBF auxiliar em CP850 é convertido antes de ler.
  if (detectDbfTextEncoding(bytes) === 'cp850') bytes = transcodeDbfCp850ToWindows1252(bytes);
  const records = [];
  for await (const record of readDbfRecords(bytes)) records.push(record);
  lookups.set(name, lookupDefinitionFromDefOption(option, records));
}
const recursos = {
  conversao: (f) => [...cnvs.keys()].find((n) => nomeBaseDoRecurso(n) === nomeBaseDoRecurso(f)),
  lookup: (f) => (lookups.has(nomeBaseDoRecurso(f)) ? nomeBaseDoRecurso(f) : undefined),
};
const catalogo = catalogoDoDef(def, recursos);
const dbf = dbcToDbf(new Uint8Array(await readFile(files.get('rdac2401.dbc'))));
const layout = readDbfHeader(dbf).fields.map((f) => ({ field: f.name, type: f.type, length: f.length, decimals: f.decimalCount }));
const records = [];
for await (const record of readDbfRecords(dbf)) records.push(record);
const registry = { ...Object.fromEntries(cnvs), ...Object.fromEntries(lookups) };

const byLabel = (list, label) => { const e = list.find((x) => x.label === label); assert.ok(e, label); return e; };
// Rótulo de lookup é "CNES nome": compara pelo código, porque o TabWin escreve
// "Säo" onde o DBF em CP850 diz "São" (conversão própria dele).
const chave = (label) => (/^\d{7}( |$)/.test(label) ? label.slice(0, 7) : label);
let failures = 0;
for (const c of expected.cases) {
  const estado = {
    ...estadoInicial(catalogo),
    linha: byLabel(catalogo.linhas, c.linha).id,
    coluna: null,
    selecoes: (c.selecoes ?? []).map(([label, codes]) => {
      const eixo = byLabel(catalogo.selecoes, label);
      const lista = categoriasDoEixo(eixo, cnvs, lookups);
      return { eixo: eixo.id, categorias: codes.map((code) => { const item = lista.find((x) => x.id === code); assert.ok(item, code); return item.id; }) };
    }),
    naoClassificados: c.naoClassificados,
    suprimirLinhasZeradas: false,
  };
  const spec = withRecordLayout(specDoPainel(catalogo, estado), layout, registry);
  const result = executeInMemory(records, compileQueryPlan(spec), registry);
  const got = result.rows.map((row, index) => [chave(row.label), result.cells[index][0]]);
  const want = c.rows.map(([label, count]) => [chave(label), count]);
  const total = got.filter((_, index) => !result.rows[index].excludeFromTotal).reduce((sum, [, count]) => sum + count, 0);
  if (JSON.stringify(got) === JSON.stringify(want) && total === c.total) console.log(`ok ${c.id} ${c.linha} (${c.naoClassificados}${c.selecoes ? ', com seleção' : ''})`);
  else {
    failures++;
    console.log(`FALHOU ${c.id} ${c.linha} total TabWin ${c.total}, TabSis ${total}`);
    for (let i = 0; i < Math.max(got.length, want.length); i++) {
      if (JSON.stringify(got[i]) !== JSON.stringify(want[i])) console.log(`   linha ${i + 1}: TabWin ${JSON.stringify(want[i])}, TabSis ${JSON.stringify(got[i])}`);
    }
  }
}
console.log(`dbf-lookup: ${expected.cases.length - failures}/${expected.cases.length} casos iguais ao TabWin 4.15`);
if (failures) process.exitCode = 1;
