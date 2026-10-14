import assert from 'node:assert/strict';
import test from 'node:test';
import { describeAuxiliaryFile, describeDatasusFile } from '../dist/packages/formats/src/index.js';

test('nome do arquivo do DATASUS vira uma descrição legível', () => {
  assert.equal(describeDatasusFile('RDAC2401.dbc').summary, 'Internações (AIH reduzida) · SIH · Acre · jan/2024');
  assert.equal(describeDatasusFile('RDAC2401.dbc').period, 'janeiro de 2024');
  assert.equal(describeDatasusFile('PAAC2501.dbc').summary, 'Produção ambulatorial · SIA · Acre · jan/2025');
  assert.equal(describeDatasusFile('STSP2312.DBC').summary, 'Estabelecimentos · CNES · São Paulo · dez/2023');
  assert.equal(describeDatasusFile('DOAC2024.dbc').summary, 'Óbitos (por residência) · SIM · Acre · 2024');
  assert.equal(describeDatasusFile('DNBR2024.dbc').summary, 'Nascidos vivos · SINASC · Brasil · 2024');
  assert.equal(describeDatasusFile('DOINF23.dbc').summary, 'Óbitos infantis · SIM · Brasil · 2023');
  assert.equal(describeDatasusFile('HANSBR23.dbc').summary, 'Hanseníase · SINAN · Brasil · 2023');
  assert.equal(describeDatasusFile('DENGBR25.parquet').summary, 'Dengue · SINAN · Brasil · 2025');
  assert.equal(describeDatasusFile('RDAC2401.parquet').place, 'Acre');
  assert.equal(describeDatasusFile('dados.csv'), null);
  assert.equal(describeDatasusFile('XXAC2401.dbc'), null);
  assert.equal(describeDatasusFile('RDXX2401.dbc'), null);
  assert.match(describeAuxiliaryFile('RD2008.DEF'), /Linhas, Colunas/);
  assert.match(describeAuxiliaryFile('SEXO.CNV'), /código pelo nome/);
});
