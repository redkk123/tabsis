import assert from 'node:assert/strict';
import test from 'node:test';
import { readPopulationTable, populationFor, populationYearFor, ratePer100k } from '../dist/packages/analysis/src/population.js';

test('acha município, população e ano pelos valores, e soma as linhas do mesmo município', () => {
  const registros = [
    { ANO: '2023', MUNIC: '355030', SEXO: '1', FX: '01', POPULACAO: '5000000' },
    { ANO: '2023', MUNIC: '355030', SEXO: '2', FX: '01', POPULACAO: '6000000' },
    { ANO: '2023', MUNIC: '150140', SEXO: '1', FX: '01', POPULACAO: '1300000' },
    { ANO: '2024', MUNIC: '355030', SEXO: '1', FX: '01', POPULACAO: '11500000' },
    { ANO: '2024', MUNIC: '150140', SEXO: '1', FX: '01', POPULACAO: '1310000' },
  ];
  const tabela = readPopulationTable(registros, ['ANO', 'MUNIC', 'SEXO', 'FX', 'POPULACAO']);
  assert.equal(tabela.codeField, 'MUNIC');
  assert.equal(tabela.yearField, 'ANO');
  assert.equal(tabela.populationField, 'POPULACAO');
  assert.equal(populationFor(tabela, '355030', '2023'), 11_000_000);
  // Código com dígito verificador e UF (soma dos municípios).
  assert.equal(populationFor(tabela, '3550308', '2024'), 11_500_000);
  assert.equal(populationFor(tabela, '35', '2024'), 11_500_000);
  // Ano sem população: o mais próximo.
  assert.equal(populationYearFor(tabela, '2025'), '2024');
  assert.equal(populationYearFor(tabela, 'Março'), '2024');
});

test('sem coluna de ano, o ano vem do nome do arquivo; sem nome POP, vale a maior soma', () => {
  const tabela = readPopulationTable([
    { COD: '1501402', AREA: '1059', HAB: '1303403' },
    { COD: '3550308', AREA: '1521', HAB: '11451999' },
    { COD: '3304557', AREA: '1200', HAB: '6211223' },
  ], ['COD', 'AREA', 'HAB'], 'POPTBR22.dbf');
  assert.equal(tabela.populationField, 'HAB');
  assert.deepEqual([...tabela.byYear.keys()], ['2022']);
  assert.equal(populationFor(tabela, '150140', '2022'), 1_303_403);
});

test('taxa por 100 mil, e nada sem população', () => {
  assert.equal(ratePer100k(50, 1_000_000), 5);
  assert.equal(ratePer100k(50, undefined), undefined);
  assert.equal(ratePer100k(50, 0), undefined);
});

test('arquivo sem códigos de município é recusado com explicação', () => {
  assert.throws(() => readPopulationTable([{ A: 'x', B: '1' }, { A: 'y', B: '2' }], ['A', 'B']), /códigos de município/);
});
