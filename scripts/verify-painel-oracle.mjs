/**
 * Confere o painel do TabSis contra o TabWin 4.15 real (captura de 2026-10-13).
 *
 * Uso: npm run verify:painel -- <pasta com RDAC2401.dbc, SEXO.CNV e CARINT.CNV>
 *
 * Os ativos não entram no git (são do oráculo privado); o esperado e o DEF de
 * teste estão em fixtures/oracle/painel-2026-10-13/expected.json.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { dbcToDbf, readDbfRecords } from '@precisa-saude/datasus-dbc';
import { parseCnv, parseDef } from '../dist/packages/formats/src/index.js';
import {
  catalogoDoDef, categoriasDoEixo, compileQueryPlan, estadoInicial, executeInMemory, nomeBaseDoRecurso, specDoPainel, subtituloDoPainel,
} from '../dist/packages/core/src/index.js';

const dir = process.argv[2];
if (!dir) throw new Error('uso: npm run verify:painel -- <pasta-dos-ativos>');
const expected = JSON.parse(await readFile(new URL('../fixtures/oracle/painel-2026-10-13/expected.json', import.meta.url), 'utf8'));
const cp1252 = new TextDecoder('windows-1252');
const cnvs = new Map([
  ['RACA1.CNV', parseCnv(expected.raca1Cnv)],
  ['RACAL.CNV', parseCnv(expected.racalCnv)],
  ['SEXO.CNV', parseCnv(cp1252.decode(await readFile(path.join(dir, 'SEXO.CNV'))))],
  ['CARINT.CNV', parseCnv(cp1252.decode(await readFile(path.join(dir, 'CARINT.CNV'))))],
]);
const recursos = {
  conversao: (f) => [...cnvs.keys()].find((n) => nomeBaseDoRecurso(n) === nomeBaseDoRecurso(f)),
  lookup: () => undefined,
};
const catalogos = {
  defText: catalogoDoDef(parseDef(expected.defText), recursos),
  def2Text: catalogoDoDef(parseDef(expected.def2Text), recursos),
};
const records = [];
for await (const r of readDbfRecords(dbcToDbf(new Uint8Array(await readFile(path.join(dir, 'RDAC2401.dbc')))))) records.push(r);

const byLabel = (list, label) => { const e = list.find((x) => x.label === label); assert.ok(e, label); return e; };
const round2 = (v) => Math.round(v * 100) / 100;
for (const c of expected.cases) {
  const p = c.panel;
  const cat = catalogos[c.def ?? 'defText'];
  const estado = {
    ...estadoInicial(cat),
    linha: byLabel(cat.linhas, p.linha).id,
    coluna: p.coluna ? byLabel(cat.colunas, p.coluna).id : null,
    incrementos: p.incrementos.map((l) => byLabel(cat.incrementos, l).id),
    selecoes: (p.selecoes ?? []).map(([label, cats]) => {
      const eixo = byLabel(cat.selecoes, label);
      const lista = categoriasDoEixo(eixo, cnvs, new Map());
      return { eixo: eixo.id, categorias: cats.map((l) => lista.find((x) => x.label === l).id) };
    }),
    naoClassificados: p.naoClassificados ?? 'ignorar',
    suprimirLinhasZeradas: p.suprimirLinhasZeradas ?? false,
    suprimirColunasZeradas: p.suprimirColunasZeradas ?? true,
  };
  const result = executeInMemory(records, compileQueryPlan(specDoPainel(cat, estado)), Object.fromEntries(cnvs));
  const rows = result.rows.map((r, i) => [r.label, ...result.cells[i].map(round2)]);
  assert.deepEqual(rows, c.rows, `${c.id}: linhas`);
  if (c.columns) assert.deepEqual(result.columns.map((x) => x.label), c.columns, `${c.id}: colunas`);
  if (c.subtitle) assert.equal(subtituloDoPainel(cat, estado), c.subtitle, `${c.id}: subtítulo`);
  if (c.total) {
    const totals = result.columns.map((_, j) => round2(result.cells.reduce((s, r) => s + r[j], 0)));
    assert.deepEqual(totals, c.total, `${c.id}: total`);
  }
  console.log(`ok ${c.id}`);
}
console.log(`painel: ${expected.cases.length}/${expected.cases.length} casos iguais ao TabWin 4.15`);
