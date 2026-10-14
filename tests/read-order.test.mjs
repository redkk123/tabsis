import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { compileQueryPlan, executeInMemory, tabwinDbcReadPosition, tabwinReadPosition } from '../dist/packages/core/src/index.js';
import { parseCnv } from '../dist/packages/formats/src/index.js';

const oracle = JSON.parse(await readFile(new URL('../fixtures/oracle/re004-ordem-dbc/expected.json', import.meta.url), 'utf8'));

test('a ordem de leitura do DBC reproduz os 4.315 registros do RDAC2401 lidos pelo TabWin (RE-004)', () => {
  const { recordCount, recordLength } = oracle.data;
  const order = new Array(recordCount);
  for (let index = 0; index < recordCount; index++) order[tabwinDbcReadPosition(index, recordLength, recordCount)] = index + 1;
  assert.deepEqual(order, oracle.readOrder);
});

test('DBF e registros soltos ficam na ordem do arquivo; vários arquivos, um depois do outro', () => {
  const position = tabwinReadPosition([{ recordCount: 3, dbc: false }, { recordCount: 4315, recordLength: 702, dbc: true }]);
  assert.deepEqual([0, 1, 2].map(position), [0, 1, 2]);
  // 6º registro do DBC (partido na fronteira de 4.096 bytes) vem depois do 11º.
  assert.equal(position(3 + 5), 3 + 10);
  assert.equal(position(3 + 6), 3 + 5);
});

test('Discriminar lista os códigos na ordem em que o TabWin os encontra, não na do arquivo', () => {
  const line = (seq, desc, codes) => `${''.padStart(3)}${String(seq).padStart(4)}  ${desc.padEnd(50)} ${codes}`;
  const cnv = parseCnv(['1 2 L', line(1, 'Nenhum', 'ZZ')].join('\n'));
  const plan = compileQueryPlan({
    compatibilityProfile: 'tabwin-4.15',
    rows: { field: 'C', conversionId: 'X', unclassifiedPolicy: 'discriminate-codes' },
    measure: { kind: 'count' }, filters: [],
  });
  const records = ['AA', 'BB', 'AA', 'CC'].map((C) => ({ C }));
  const labels = (options) => executeInMemory(records, plan, { X: cnv }, options).rows.map((row) => row.label);
  assert.deepEqual(labels(), ['Nenhum', 'AA', 'BB', 'CC']);
  // Leitura em que o 2º registro vem por último: BB passa a ser o último código.
  assert.deepEqual(labels({ readPosition: (index) => [0, 3, 1, 2][index] }), ['Nenhum', 'AA', 'CC', 'BB']);
});
