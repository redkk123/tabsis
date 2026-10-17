import assert from 'node:assert/strict';
import test from 'node:test';
import { nameGeographicLabels } from '../dist/packages/analysis/src/geographic-labels.js';

const nomes = {
  ufs: { 15: { sigla: 'PA', nome: 'Pará' }, 35: { sigla: 'SP', nome: 'São Paulo' } },
  municipios: { 150140: 'Belém', 355030: 'São Paulo', 330455: 'Rio de Janeiro' },
};
const eixo = (...chaves) => chaves.map((key) => ({ key, label: key, source: 'raw' }));
const resultado = (rows, columns = eixo('total')) => ({
  rows, columns, cells: rows.map(() => [1]), warnings: [], recordsSeen: 1, recordsAccepted: 1,
});

test('códigos de município viram nome, com o código junto e a chave intacta', () => {
  const saida = nameGeographicLabels(resultado(eixo('150140', '355030')), { rows: 'CODMUNRES' }, nomes);
  assert.deepEqual(saida.rows.map((linha) => linha.label), ['Belém (150140)', 'São Paulo (355030)']);
  assert.deepEqual(saida.rows.map((linha) => linha.key), ['150140', '355030']);
});

test('código de sete dígitos (com verificador) acha o mesmo município', () => {
  const saida = nameGeographicLabels(resultado(eixo('1501402')), {}, nomes);
  assert.equal(saida.rows[0].label, 'Belém (1501402)');
});

test('não depende do nome do campo, mas exige que os códigos existam', () => {
  // CBO tem seis dígitos e não é município: nada casa, nada muda.
  const cbo = resultado(eixo('225125', '715210', '411010'));
  assert.equal(nameGeographicLabels(cbo, { rows: 'OCUPACAO' }, nomes), cbo);
  // Um código desconhecido entre dez não impede os outros nove (90%)…
  const dez = Array.from({ length: 9 }, (_, i) => `11000${i + 1}`);
  const tabela = { ufs: {}, municipios: Object.fromEntries(dez.map((c) => [c, `M${c}`])) };
  const quase = nameGeographicLabels(resultado(eixo(...dez, '999999')), {}, tabela);
  assert.equal(quase.rows[0].label, 'M110001 (110001)');
  assert.equal(quase.rows.at(-1).label, '999999');
  // …mas metade desconhecida não é um campo de município.
  const metade = resultado(eixo('110001', '110002', '999991', '999992'));
  assert.equal(nameGeographicLabels(metade, {}, tabela), metade);
});

test('rótulo que já é nome (da CNV do DEF) e linhas derivadas não são tocados', () => {
  const rows = [
    { key: '150140', label: 'Belém, PA', source: 'conversion' },
    { key: '355030', label: '355030', source: 'raw' },
    { key: 'total', label: 'Total', source: 'derived' },
  ];
  const saida = nameGeographicLabels(resultado(rows), {}, nomes);
  assert.deepEqual(saida.rows.map((linha) => linha.label), ['Belém, PA', 'São Paulo (355030)', 'Total']);
});

test('UF em código só vira nome se o campo for de UF', () => {
  const uf = resultado(eixo('15', '35'));
  assert.deepEqual(nameGeographicLabels(uf, { rows: 'UF_ZI' }, nomes).rows.map((linha) => linha.label), ['Pará (15)', 'São Paulo (35)']);
  // Idade 15 e 35 colidem com os códigos de UF: sem campo de UF, ficam como estão.
  assert.equal(nameGeographicLabels(uf, { rows: 'IDADE' }, nomes), uf);
});

test('colunas também são traduzidas', () => {
  const saida = nameGeographicLabels(resultado(eixo('x'), eixo('150140', '355030')), { columns: 'ID_MUNICIP' }, nomes);
  assert.equal(saida.columns[0].label, 'Belém (150140)');
});
