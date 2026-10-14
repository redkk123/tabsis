import assert from 'node:assert/strict';
import test from 'node:test';
import { parseCnv } from '../dist/packages/formats/src/index.js';
import { compileQueryPlan, executeInMemory, withRecordLayout } from '../dist/packages/core/src/index.js';
import { fieldsUsedByPlan } from '../dist/packages/core/src/plan-fields.js';

function row(sequence, label, codes) {
  return `${''.padStart(3)}${String(sequence).padStart(4)}  ${label.padEnd(50).slice(0, 50)} ${codes}`;
}

// Recorte da IDADE18.CNV do SIH: código de 3 = unidade (COD_IDADE) + idade (IDADE).
const idade = parseCnv(['5 3', row(5, 'Ign', '000-999'), row(1, '<1a', '100-312,400'), row(2, '1-4a', '401-404'),
  row(3, '5-9a', '405-409'), row(4, '20-24a', '420-424')].join('\n'));
const layout = [
  { field: 'SEXO', type: 'C', length: 1, decimals: 0 },
  { field: 'COD_IDADE', type: 'C', length: 1, decimals: 0 },
  { field: 'IDADE', type: 'N', length: 2, decimals: 0 },
  { field: 'MORTE', type: 'N', length: 1, decimals: 0 },
];
const records = [
  { SEXO: '1', COD_IDADE: '4', IDADE: 22, MORTE: 0 },
  { SEXO: '3', COD_IDADE: '4', IDADE: 5, MORTE: 0 },
  { SEXO: '1', COD_IDADE: '2', IDADE: 10, MORTE: 0 },
  { SEXO: '3', COD_IDADE: '4', IDADE: 2, MORTE: 1 },
];

test('Faixa etária do SIH: o código de 3 atravessa COD_IDADE (1) para IDADE (2), como o TabWin lê', () => {
  const spec = withRecordLayout({
    compatibilityProfile: 'tabwin-4.15', rows: { field: 'COD_IDADE', conversionId: 'IDADE18', startPosition: 1 },
    measure: { kind: 'count' }, filters: [],
  }, layout, { IDADE18: idade });
  assert.deepEqual(spec.rows.recordSpan.map((field) => field.field), ['COD_IDADE', 'IDADE']);
  const plan = compileQueryPlan(spec);
  assert.deepEqual(fieldsUsedByPlan(plan).sort(), ['COD_IDADE', 'IDADE']);
  const result = executeInMemory(records, plan, { IDADE18: idade });
  const counts = Object.fromEntries(result.rows.map((r, i) => [r.label, result.cells[i][0]]));
  // "422" → 20-24a; "4 5" (idade 5 alinhada à direita, espaço vale 0) → 405 → 5-9a; "210" → <1a; "4 2" → 1-4a.
  assert.deepEqual(counts, { '<1a': 1, '1-4a': 1, '5-9a': 1, '20-24a': 1, Ign: 0 });
  // Sem a estrutura do registro, lia só o "4" — o erro que existia antes.
  const semLayout = executeInMemory(records, compileQueryPlan({ ...spec, rows: { ...spec.rows, recordSpan: undefined } }), { IDADE18: idade });
  assert.notDeepEqual(semLayout.cells, result.cells);
});

test('withRecordLayout não mexe em campo de texto que comporta o código, e vale para filtros', () => {
  const sexo = parseCnv(['2 1', row(1, 'Masculino', '1'), row(2, 'Feminino', '3')].join('\n'));
  const spec = withRecordLayout({
    compatibilityProfile: 'tabwin-4.15', rows: { field: 'SEXO', conversionId: 'SEXO' }, measure: { kind: 'count' },
    filters: [{ field: 'COD_IDADE', conversionId: 'IDADE18', startPosition: 1, acceptedCategories: ['4'] }],
  }, layout, { SEXO: sexo, IDADE18: idade });
  assert.equal(spec.rows.recordSpan, undefined);
  assert.deepEqual(spec.filters[0].recordSpan.map((field) => field.field), ['COD_IDADE', 'IDADE']);
  const result = executeInMemory(records, compileQueryPlan(spec), { SEXO: sexo, IDADE18: idade });
  assert.equal(result.recordsAccepted, 1);
  assert.throws(() => compileQueryPlan({ ...spec, filters: [{ ...spec.filters[0], recordSpan: [{ field: 'IDADE', type: 'N', length: 2, decimals: 0 }] }] }), /start at its own field/);
});

test('Incluir: a linha "Não classificados" só aparece se houver algum (TabWin não mostra vazia)', () => {
  const sexo = parseCnv(['2 1', row(1, 'Masculino', '1'), row(2, 'Feminino', '3')].join('\n'));
  const spec = { compatibilityProfile: 'tabwin-4.15', rows: { field: 'SEXO', conversionId: 'SEXO', unclassifiedPolicy: 'discriminate' }, measure: { kind: 'count' }, filters: [] };
  const semNenhum = executeInMemory(records, compileQueryPlan(spec), { SEXO: sexo });
  assert.deepEqual(semNenhum.rows.map((r) => r.label), ['Masculino', 'Feminino']);
  const comUm = executeInMemory([...records, { SEXO: '9' }], compileQueryPlan(spec), { SEXO: sexo });
  assert.deepEqual(comUm.rows.map((r) => r.label), ['Masculino', 'Feminino', 'Não classificados']);
  assert.equal(comUm.cells.at(-1)[0], 1);
});
