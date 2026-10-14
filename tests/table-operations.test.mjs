import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyTableOperation,
  calculateColumnTotal,
  createIncludeTableOperation,
  replayTableOperations,
} from '../dist/packages/analysis/src/table-operations.js';

const base = {
  rows: [
    { key: 'a', label: 'A', source: 'raw' },
    { key: 'b', label: 'B', source: 'raw', excludeFromTotal: true },
    { key: 'c', label: 'C', source: 'raw' },
  ],
  columns: [
    { key: 'x', label: 'X', source: 'raw' },
    { key: 'y', label: 'Y', source: 'raw' },
  ],
  cells: [[10, 2], [-5, 0], [3, 4]],
  warnings: [], recordsSeen: 3, recordsAccepted: 3,
};

const output = (key, label = key, totalPolicy = 'sum') => ({ key, label, totalPolicy });

test('binary operations append an immutable, auditable derived column', () => {
  const operation = {
    kind: 'binary', operator: 'subtract', leftColumnKey: 'x', rightColumnKey: 'y',
    divisionByZero: 'error', output: output('delta', 'Diferença'),
  };
  const { result, audit } = applyTableOperation(base, operation);
  assert.deepEqual(result.cells, [[10, 2, 8], [-5, 0, -5], [3, 4, -1]]);
  assert.deepEqual(base.cells, [[10, 2], [-5, 0], [3, 4]]);
  assert.deepEqual(result.columns.at(-1), {
    key: 'delta', label: 'Diferença', source: 'derived', totalPolicy: 'sum',
  });
  assert.equal(audit.compatibility, 'modern-explicit-policy');
});

test('division and percentage require an explicit zero-denominator policy', () => {
  const operation = {
    kind: 'binary', operator: 'percentage', leftColumnKey: 'x', rightColumnKey: 'y',
    divisionByZero: 'error', output: output('pct'),
  };
  assert.throws(() => applyTableOperation(base, operation), /division by zero.*row 2/);
  const { result } = applyTableOperation(base, { ...operation, divisionByZero: 'zero' });
  assert.deepEqual(result.cells.map((row) => row.at(-1)), [500, 0, 75]);
});

test('factor, cumulative, absolute, integer, constant and sequence replay deterministically', () => {
  const operations = [
    { kind: 'factor', sourceColumnKey: 'x', factor: 2, output: output('double') },
    { kind: 'cumulative', sourceColumnKey: 'x', output: output('running', 'Acumulado', 'final') },
    { kind: 'absolute', sourceColumnKey: 'x', output: output('absolute') },
    { kind: 'integer', sourceColumnKey: 'double', rounding: 'truncate', output: output('integer') },
    { kind: 'constant', value: 7, output: output('constant') },
    { kind: 'sequence', start: 1, step: 2, output: output('sequence', 'Sequência', 'final') },
  ];
  const result = replayTableOperations(base, operations);
  assert.deepEqual(result.cells.map((row) => row.slice(2)), [
    [20, 10, 10, 20, 7, 1],
    [-10, 5, 5, -10, 7, 3],
    [6, 8, 3, 6, 7, 5],
  ]);
});

test('column totals implement documented policies and honor excluded rows', () => {
  assert.equal(calculateColumnTotal(base, 'x', 'sum'), 13);
  assert.equal(calculateColumnTotal(base, 'x', 'product'), 30);
  assert.equal(calculateColumnTotal(base, 'x', 'mean'), 6.5);
  assert.equal(calculateColumnTotal(base, 'x', 'initial'), 10);
  assert.equal(calculateColumnTotal(base, 'x', 'final'), 3);
  assert.equal(calculateColumnTotal(base, 'x', 'min'), 3);
  assert.equal(calculateColumnTotal(base, 'x', 'max'), 10);
  assert.equal(calculateColumnTotal(base, 'x', 'none'), undefined);
});

test('operations reject missing and duplicate columns', () => {
  assert.throws(() => applyTableOperation(base, {
    kind: 'absolute', sourceColumnKey: 'missing', output: output('new'),
  }), /missing column/);
  assert.throws(() => applyTableOperation(base, {
    kind: 'constant', value: 1, output: output('x'),
  }), /already exists/);
});

test('column rename, movement and deletion are immutable replayable operations', () => {
  const renamed = applyTableOperation(base, { kind: 'rename-column', columnKey: 'x', label: 'Casos' }).result;
  assert.equal(renamed.columns[0].label, 'Casos');
  const moved = applyTableOperation(renamed, { kind: 'move-column', columnKey: 'x', direction: 'right' }).result;
  assert.deepEqual(moved.columns.map((column) => column.key), ['y', 'x']);
  assert.deepEqual(moved.cells[0], [2, 10]);
  const deleted = applyTableOperation(moved, { kind: 'delete-column', columnKey: 'y' }).result;
  assert.deepEqual(deleted.columns.map((column) => column.key), ['x']);
  assert.deepEqual(deleted.cells.map((row) => row[0]), [10, -5, 3]);
  assert.equal(base.columns[0].label, 'X');
});

test('transpose swaps axes and matrix without mutating or losing metadata', () => {
  const transposed = applyTableOperation(base, { kind: 'transpose' }).result;
  assert.deepEqual(transposed.rows, base.columns);
  assert.deepEqual(transposed.columns, base.rows);
  assert.deepEqual(transposed.cells, [[10, -5, 3], [2, 0, 4]]);
  assert.deepEqual(base.cells, [[10, 2], [-5, 0], [3, 4]]);
  const restored = applyTableOperation(transposed, { kind: 'transpose' }).result;
  assert.deepEqual(restored, base);
});

test('include table appends columns by an exact row-key join and reorders the included rows', () => {
  const included = {
    rows: [{ key: 'c', label: 'C', source: 'raw' }, { key: 'a', label: 'A', source: 'raw' }, { key: 'b', label: 'B', source: 'raw' }],
    columns: [{ key: 'population', label: 'População', source: 'raw', totalPolicy: 'sum' }],
    cells: [[300], [100], [200]], warnings: [], recordsSeen: 3, recordsAccepted: 3,
  };
  const operation = createIncludeTableOperation(base, included, 'Censo 2022');
  const { result, audit } = applyTableOperation(base, operation);
  assert.deepEqual(result.columns.map((column) => column.key), ['x', 'y', 'censo-2022:population']);
  assert.deepEqual(result.cells, [[10, 2, 100], [-5, 0, 200], [3, 4, 300]]);
  assert.match(result.warnings.at(-1), /modern explicit policy/);
  assert.equal(audit.compatibility, 'modern-explicit-policy');
  assert.deepEqual(base.cells, [[10, 2], [-5, 0], [3, 4]]);
});

test('include table rejects missing keys, label disagreements and non-finite cells', () => {
  const included = {
    rows: [{ key: 'a', label: 'A', source: 'raw' }],
    columns: [{ key: 'z', label: 'Z', source: 'raw' }],
    cells: [[1]], warnings: [], recordsSeen: 1, recordsAccepted: 1,
  };
  assert.throws(() => applyTableOperation(base, createIncludeTableOperation(base, included, 'Outra')), /exactly match/);
  const exact = { ...included, rows: base.rows.map((row) => ({ ...row })), cells: [[1], [2], [3]] };
  const labelMismatch = createIncludeTableOperation(base, exact, 'Outra');
  labelMismatch.rows[0].label = 'Diferente';
  assert.throws(() => applyTableOperation(base, labelMismatch), /label differs/);
  const nonFinite = createIncludeTableOperation(base, exact, 'Outra');
  nonFinite.cells[0][0] = Number.NaN;
  assert.throws(() => applyTableOperation(base, nonFinite), /non-finite/);
});

test('row suppression removes matched rows without changing source totals', () => {
  const suppressed = applyTableOperation(base, { kind: 'suppress-rows', rowKeys: ['b'] }).result;
  assert.deepEqual(suppressed.rows.map((row) => row.key), ['a', 'c']);
  assert.deepEqual(suppressed.cells, [[10, 2], [3, 4]]);
  assert.equal(base.rows.length, 3);
});

test('row aggregation can replace sources or append an excluded subtotal', () => {
  const replaced = applyTableOperation(base, {
    kind: 'aggregate-rows', rowKeys: ['a', 'c'],
    outputRow: { key: 'ac', label: 'A + C', excludeFromTotal: false }, removeSources: true,
  }).result;
  assert.deepEqual(replaced.rows.map((row) => row.key), ['b', 'ac']);
  assert.deepEqual(replaced.cells.at(-1), [13, 6]);
  const appended = applyTableOperation(base, {
    kind: 'aggregate-rows', rowKeys: ['a', 'c'],
    outputRow: { key: 'subtotal', label: 'Subtotal', excludeFromTotal: true }, removeSources: false,
  }).result;
  assert.equal(appended.rows.at(-1).excludeFromTotal, true);
  assert.equal(calculateColumnTotal(appended, 'x', 'sum'), 13);
});

test('structural operations reject destructive or ambiguous requests', () => {
  assert.throws(() => applyTableOperation({ ...base, columns: [base.columns[0]], cells: base.cells.map((row) => [row[0]]) },
    { kind: 'delete-column', columnKey: 'x' }), /retain at least one/);
  assert.throws(() => applyTableOperation(base, { kind: 'move-column', columnKey: 'x', direction: 'left' }), /cannot move/);
  assert.throws(() => applyTableOperation(base, { kind: 'suppress-rows', rowKeys: [] }), /at least one/);
});

test('%percentagem e Normalizar fazem o que o TabWin faz (decompilado)', async () => {
  const { applyTableOperation } = await import('../dist/packages/analysis/src/table-operations.js');
  const base = {
    rows: [{ key: 'N', label: 'Região Norte', source: 'conversion' }, { key: 'AC', label: '.. Acre', source: 'conversion', excludeFromTotal: true }, { key: 'X', label: 'Outra', source: 'conversion' }],
    columns: [{ key: 'C', label: 'Freqüência', source: 'raw' }],
    cells: [[30], [30], [10]],
    warnings: [], recordsSeen: 40, recordsAccepted: 40,
  };
  const pct = applyTableOperation(base, { kind: 'percent-of-total', sourceColumnKey: 'C', output: { key: 'P', label: '%Freqüência', totalPolicy: 'sum' } }).result;
  // O total da coluna pula a linha de detalhe de subtotal: 40, não 70.
  assert.deepEqual(pct.cells.map((row) => row[1]), [75, 75, 25]);
  const z = applyTableOperation({ ...base, cells: [[1], [2], [3]] }, { kind: 'normalize', sourceColumnKey: 'C', output: { key: 'Z', label: 'ZFreqüência', totalPolicy: 'none' } }).result;
  assert.deepEqual(z.cells.map((row) => row[1]), [-1, 0, 1]);
  assert.throws(() => applyTableOperation({ ...base, cells: [[2], [2], [2]] }, { kind: 'normalize', sourceColumnKey: 'C', output: { key: 'Z', label: 'Z', totalPolicy: 'none' } }), /not all equal/);
});

test('Calcular indicador: A × escala ÷ B por linha, zero com B zero, e o total é a razão dos totais', async () => {
  const { applyTableOperation } = await import('../dist/packages/analysis/src/table-operations.js');
  const base = {
    rows: [{ key: '1', label: 'Acre', source: 'conversion' }, { key: '2', label: 'Amapá', source: 'conversion' }, { key: '3', label: 'Pará', source: 'conversion' }],
    columns: [{ key: 'OB', label: 'Óbitos', source: 'raw' }, { key: 'POP', label: 'População', source: 'raw' }],
    cells: [[10, 900_000], [3, 0], [50, 8_000_000]],
    warnings: [], recordsSeen: 63, recordsAccepted: 63,
  };
  const r = applyTableOperation(base, {
    kind: 'indicator', numeratorColumnKey: 'OB', denominatorColumnKey: 'POP', scalePower: 5,
    output: { key: 'TX', label: 'Taxa por 100.000', totalPolicy: 'sum' },
  }).result;
  assert.deepEqual(r.cells.map((row) => Number(row[2].toFixed(4))), [1.1111, 0, 0.625]);
  const coluna = r.columns.at(-1);
  assert.equal(coluna.totalPolicy, 'precalculated');
  // 63 × 100.000 ÷ 8.900.000, e não a soma das taxas.
  assert.equal(Number(coluna.precalculatedTotal.toFixed(6)), Number((63 * 1e5 / 8_900_000).toFixed(6)));
});

test('Fixar comprimento da chave: o código IBGE de 7 dígitos do TabNet casa com o de 6 do TabWin', async () => {
  const { applyTableOperation, createIncludeTableOperation } = await import('../dist/packages/analysis/src/table-operations.js');
  const tabwin = {
    rows: [{ key: '120040', label: 'Rio Branco', source: 'raw' }, { key: '120020', label: 'Cruzeiro do Sul', source: 'raw' }],
    columns: [{ key: 'C', label: 'Internações', source: 'raw' }], cells: [[1789], [546]],
    warnings: [], recordsSeen: 2335, recordsAccepted: 2335,
  };
  const tabnet = {
    rows: [{ key: '1200203', label: 'CRUZEIRO DO SUL', source: 'raw' }, { key: '1200401', label: 'RIO BRANCO', source: 'raw' }],
    columns: [{ key: 'P', label: 'População', source: 'raw' }], cells: [[91888], [364756]],
    warnings: [], recordsSeen: 0, recordsAccepted: 0,
  };
  assert.throws(() => applyTableOperation(tabwin, createIncludeTableOperation(tabwin, tabnet, 'TabNet')), /exactly match/);
  const r = applyTableOperation(tabwin, createIncludeTableOperation(tabwin, tabnet, 'TabNet', { keyLength: 6 })).result;
  assert.deepEqual(r.cells, [[1789, 364756], [546, 91888]]);
});

// Manual do curso TabWin (SESAP-RN/COSEMS-RN, fev/2011), p. 49–58: Somar,
// Mínimo e Máximo de várias colunas, total de Produto/Quociente, Tipo de
// total, Recalcula total, Decimais e Seqüência depois de ordenar.
test('Soma, Menor e Maior de várias colunas; a soma não conta a linha excluída do total', async () => {
  const { applyTableOperation, calculateColumnTotal } = await import('../dist/packages/analysis/src/table-operations.js');
  const coluna = (operator) => applyTableOperation(base, {
    kind: 'aggregate-columns', operator, columnKeys: ['x', 'y'], output: output(operator),
  }).result;
  assert.deepEqual(coluna('add').cells.map((row) => row[2]), [12, -5, 7]);
  assert.deepEqual(coluna('minimum').cells.map((row) => row[2]), [2, -5, 3]);
  assert.deepEqual(coluna('maximum').cells.map((row) => row[2]), [10, 0, 4]);
  assert.equal(calculateColumnTotal(coluna('add'), 'add'), 19);
  assert.throws(() => applyTableOperation(base, {
    kind: 'aggregate-columns', operator: 'add', columnKeys: ['x'], output: output('s'),
  }), /at least two/);
});

test('Produto e Quociente: o total pré-calculado é a conta feita nos totais, e encadeia', async () => {
  const { applyTableOperation, displayedColumnTotal } = await import('../dist/packages/analysis/src/table-operations.js');
  const produto = applyTableOperation(base, {
    kind: 'binary', operator: 'multiply', leftColumnKey: 'x', rightColumnKey: 'y',
    divisionByZero: 'error', output: output('p', 'Produto', 'precalculated'),
  }).result;
  // 13 × 6, não a soma dos produtos (20 + 12 = 32).
  assert.equal(displayedColumnTotal(produto, 'p'), 78);
  const quociente = applyTableOperation(base, {
    kind: 'binary', operator: 'divide', leftColumnKey: 'x', rightColumnKey: 'y',
    divisionByZero: 'zero', output: output('q', 'Quociente', 'precalculated'),
  }).result;
  assert.equal(displayedColumnTotal(quociente, 'q'), 13 / 6);
  const deNovo = applyTableOperation(quociente, {
    kind: 'binary', operator: 'divide', leftColumnKey: 'q', rightColumnKey: 'x',
    divisionByZero: 'zero', output: output('qq', 'Quociente', 'precalculated'),
  }).result;
  assert.equal(displayedColumnTotal(deNovo, 'qq'), (13 / 6) / 13);
  assert.throws(() => applyTableOperation(base, {
    kind: 'binary', operator: 'add', leftColumnKey: 'x', rightColumnKey: 'y',
    divisionByZero: 'error', output: output('s', 'Soma', 'precalculated'),
  }), /precalculated total is only defined/);
});

test('Tipo de total e Recalcula total: Pré-calculado congela; Soma volta a somar', async () => {
  const { applyTableOperation, displayedColumnTotal, replayTableOperations } = await import('../dist/packages/analysis/src/table-operations.js');
  const media = applyTableOperation(base, { kind: 'set-total-policy', columnKeys: ['x'], totalPolicy: 'mean' }).result;
  assert.equal(displayedColumnTotal(media, 'x'), 6.5);
  const congelado = replayTableOperations(base, [
    { kind: 'set-total-policy', columnKeys: ['x', 'y'], totalPolicy: 'precalculated' },
    { kind: 'suppress-rows', rowKeys: ['a'] },
  ]);
  assert.equal(displayedColumnTotal(congelado, 'x'), 13);
  assert.equal(displayedColumnTotal(congelado, 'y'), 6);
  const recalculado = applyTableOperation(congelado, { kind: 'set-total-policy', columnKeys: ['x'], totalPolicy: 'sum' }).result;
  assert.equal(displayedColumnTotal(recalculado, 'x'), 3);
  assert.equal(recalculado.columns[0].precalculatedTotal, undefined);
  assert.throws(() => applyTableOperation(base, { kind: 'set-total-policy', columnKeys: [], totalPolicy: 'sum' }), /at least one/);
});

test('Decimais por coluna: na nova coluna e depois, em qualquer coluna', async () => {
  const { applyTableOperation } = await import('../dist/packages/analysis/src/table-operations.js');
  const pct = applyTableOperation(base, {
    kind: 'expression', expression: 'c2/c1*100', divisionByZero: 'zero',
    output: { ...output('pct', 'Percentagem'), decimals: 2 },
  }).result;
  assert.equal(pct.columns.at(-1).decimals, 2);
  const fixada = applyTableOperation(pct, { kind: 'set-decimals', columnKeys: ['x'], decimals: 1 }).result;
  assert.equal(fixada.columns[0].decimals, 1);
  const solta = applyTableOperation(fixada, { kind: 'set-decimals', columnKeys: ['x'], decimals: null }).result;
  assert.equal('decimals' in solta.columns[0], false);
  assert.throws(() => applyTableOperation(base, { kind: 'set-decimals', columnKeys: ['x'], decimals: 11 }), /0 to 10/);
  assert.throws(() => applyTableOperation(base, {
    kind: 'constant', value: 1, output: { ...output('k'), decimals: 1.5 },
  }), /0 to 10/);
});

test('Seqüência depois de ordenar numera pela posição na ordem (as "n" maiores)', async () => {
  const { applyTableOperation } = await import('../dist/packages/analysis/src/table-operations.js');
  const maiores = applyTableOperation(base, {
    kind: 'sequence', start: 1, step: 1, order: { columnKey: 'x', direction: 'descending' }, output: output('seq', 'Seqüência'),
  }).result;
  assert.deepEqual(maiores.cells.map((row) => row[2]), [1, 3, 2]);
  const menores = applyTableOperation(base, {
    kind: 'sequence', start: 1, step: 1, order: { columnKey: 'x', direction: 'ascending' }, output: output('seq', 'Seqüência'),
  }).result;
  assert.deepEqual(menores.cells.map((row) => row[2]), [3, 1, 2]);
});

test('a receita aceita as operações novas e recusa as malformadas', async () => {
  const { validateTableOperation } = await import('../dist/packages/core/src/recipe.js');
  for (const operation of [
    { kind: 'set-total-policy', columnKeys: ['x'], totalPolicy: 'precalculated' },
    { kind: 'set-decimals', columnKeys: ['x'], decimals: null },
    { kind: 'set-decimals', columnKeys: ['x'], decimals: 2 },
    { kind: 'aggregate-columns', operator: 'maximum', columnKeys: ['x', 'y'], output: output('m', 'Maior') },
    { kind: 'sequence', start: 1, step: 1, order: { columnKey: 'x', direction: 'descending' }, output: output('s') },
    { kind: 'constant', value: 1, output: { ...output('k'), decimals: 3 } },
  ]) validateTableOperation(operation);
  for (const operation of [
    { kind: 'set-total-policy', columnKeys: ['x'], totalPolicy: 'average' },
    { kind: 'set-decimals', columnKeys: [], decimals: 2 },
    { kind: 'set-decimals', columnKeys: ['x'], decimals: -1 },
    { kind: 'sequence', start: 1, step: 1, order: { columnKey: 'x', direction: 'sideways' }, output: output('s') },
    { kind: 'constant', value: 1, output: { ...output('k'), decimals: 'dois' } },
  ]) assert.throws(() => validateTableOperation(operation), /invalid/);
});
