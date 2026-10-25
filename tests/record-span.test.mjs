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

test('Seleção com CNV de faixas: o TabWin lê o texto a partir do índice = posição e entra no campo seguinte; a Linha usa o valor', () => {
  // PERM.CNV ("12 4 F") com DIAS_PERM N5 + MORTE N1, como nas sondas SONDB/SONDC/SONDD (2026-10-24).
  const perm = parseCnv(['3 4 F', row(1, '0 dias', '0000'), row(2, '1 dia', '0001'), row(3, '8-14 dias', '0014')].join('\n'));
  const leiaute = [{ field: 'DIAS_PERM', type: 'N', length: 5, decimals: 0 }, { field: 'MORTE', type: 'N', length: 1, decimals: 0 }];
  // Strings como o leitor de DBF entrega: o campo numérico fica alinhado à direita no registro.
  const regs = [{ DIAS_PERM: '0', MORTE: '0' }, { DIAS_PERM: '0', MORTE: '1' }, { DIAS_PERM: '1', MORTE: '0' }];
  const tabular = (startPosition, categorias) => executeInMemory(regs, compileQueryPlan(withRecordLayout({
    compatibilityProfile: 'tabwin-4.15', rows: { field: 'DIAS_PERM', conversionId: 'PERM', startPosition: 2 }, measure: { kind: 'count' },
    filters: [{ field: 'DIAS_PERM', conversionId: 'PERM', startPosition, acceptedCategories: categorias }],
  }, leiaute, { PERM: perm })), { PERM: perm });
  const porLinha = (r) => Object.fromEntries(r.rows.map((linha, i) => [linha.label, r.cells[i][0]]));
  // Posição 1: lê "   0", "   1" — o próprio valor.
  assert.deepEqual(porLinha(tabular(1, ['1', '2'])), { '0 dias': 2, '1 dia': 1, '8-14 dias': 0 });
  // Posição 2: lê "  0"+MORTE: o óbito com 0 dia vira "1 dia"; 1 dia vira "10" (8-14).
  assert.deepEqual(porLinha(tabular(2, ['2'])), { '0 dias': 1, '1 dia': 0, '8-14 dias': 0 });
  assert.deepEqual(porLinha(tabular(2, ['3'])), { '0 dias': 0, '1 dia': 1, '8-14 dias': 0 });
});

test('campo do DEF com outra caixa (CODMUNres, seriescmae) acha o campo do DBF, como no TabWin', () => {
  const sexo = parseCnv(['2 1', row(1, 'Masculino', '1'), row(2, 'Feminino', '3')].join('\n'));
  const spec = withRecordLayout({
    compatibilityProfile: 'tabwin-4.15', rows: { field: 'sexo', conversionId: 'SEXO' }, measure: { kind: 'sum', field: 'Idade' },
    filters: [{ field: 'cod_idade', acceptedCategories: ['4'] }],
  }, layout, { SEXO: sexo });
  assert.equal(spec.rows.field, 'SEXO');
  assert.equal(spec.measure.field, 'IDADE');
  assert.equal(spec.filters[0].field, 'COD_IDADE');
  const result = executeInMemory(records, compileQueryPlan(spec), { SEXO: sexo });
  assert.deepEqual(result.cells, [[22], [7]]);
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

test('o que cai direto numa linha-subtotal entra no Total (CID10_BR: A41 só no grupo A000-B999)', async () => {
  const { calculateColumnTotal } = await import('../dist/packages/analysis/src/table-operations.js');
  const cid = parseCnv(['3 4', row(1, '001-031 Infecciosas', 'A000-B999'), row(2, '  001 Intestinais', 'A000-A099'), row(3, '  005 Tuberculose', 'A150-A169')]
    .map((line, i) => (i >= 2 ? `  1${line.slice(3)}` : line)).join('\n'));
  const spec = { compatibilityProfile: 'tabwin-4.15', rows: { field: 'CAUSABAS', conversionId: 'CID' }, measure: { kind: 'count' }, filters: [] };
  const result = executeInMemory([{ CAUSABAS: 'A09' }, { CAUSABAS: 'A150' }, { CAUSABAS: 'A419' }], compileQueryPlan(spec), { CID: cid });
  const counts = Object.fromEntries(result.rows.map((r, i) => [r.label.trim(), result.cells[i][0]]));
  assert.deepEqual(counts, { '001-031 Infecciosas': 3, '001 Intestinais': 1, '005 Tuberculose': 1 });
  assert.equal(calculateColumnTotal(result, result.columns[0].key, 'sum'), 3);
});

test('campo de data (DBF tipo D) é lido como AAAAMMDD, como o TabWin (DTALTA_N do SINAN)', () => {
  const meses = parseCnv(['3 2', row(3, 'Ign', '00-99'), row(1, 'Fevereiro', '02'), row(2, 'Branco', '  ,')].join('\n'));
  const anos = parseCnv(['2 4', row(1, '2024', '2024'), row(2, 'IGN', '    ,')].join('\n'));
  const lay = [{ field: 'DTALTA_N', type: 'D', length: 8, decimals: 0 }];
  const recs = [{ DTALTA_N: new Date(Date.UTC(2024, 1, 20)) }, { DTALTA_N: null }];
  const mes = withRecordLayout({ compatibilityProfile: 'tabwin-4.15', rows: { field: 'DTALTA_N', conversionId: 'M', startPosition: 5 }, measure: { kind: 'count' }, filters: [] }, lay, { M: meses });
  const r1 = executeInMemory(recs, compileQueryPlan(mes), { M: meses });
  assert.deepEqual(Object.fromEntries(r1.rows.map((r, i) => [r.label, r1.cells[i][0]])), { Ign: 0, Fevereiro: 1, Branco: 1 });
  const ano = withRecordLayout({ compatibilityProfile: 'tabwin-4.15', rows: { field: 'DTALTA_N', conversionId: 'A', startPosition: 1 }, measure: { kind: 'count' }, filters: [] }, lay, { A: anos });
  const r2 = executeInMemory(recs, compileQueryPlan(ano), { A: anos });
  assert.deepEqual(Object.fromEntries(r2.rows.map((r, i) => [r.label, r2.cells[i][0]])), { 2024: 1, IGN: 1 });
});
