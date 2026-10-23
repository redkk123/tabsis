import assert from 'node:assert/strict';
import test from 'node:test';
import { dateFieldCandidates, detectDateLayout, datePartsFor, datePartCnvText } from '../dist/packages/analysis/src/date-fields.js';
import { parseCnv, classifyCnv } from '../dist/packages/formats/src/index.js';

test('candidatos: tipo D, texto de 8 dígitos e semana SEM… de 6', () => {
  const nomes = dateFieldCandidates([
    { name: 'DT_NOTIFIC', type: 'D', length: 8 },
    { name: 'DTOBITO', type: 'C', length: 8 },
    { name: 'SEM_NOT', type: 'C', length: 6 },
    { name: 'CODMUNRES', type: 'C', length: 6 },
    { name: 'IDADE', type: 'N', length: 3 },
  ]).map((campo) => campo.name);
  assert.deepEqual(nomes, ['DT_NOTIFIC', 'DTOBITO', 'SEM_NOT']);
});

test('o formato vem dos valores, não do nome: SIH/SINAN AAAAMMDD, SIM DDMMAAAA, semana AAAASS', () => {
  const texto = (name, length = 8) => ({ name, type: 'C', length });
  assert.equal(detectDateLayout(texto('DT_INTER'), ['20240105', '20240131', '20240212', '']), 'ymd');
  assert.equal(detectDateLayout(texto('DTOBITO'), ['05012024', '31012024', '12022024']), 'dmy');
  assert.equal(detectDateLayout(texto('SEM_NOT', 6), ['202401', '202402', '202452']), 'yw');
  assert.equal(detectDateLayout({ name: 'DT_NOTIFIC', type: 'D' }, []), 'ymd');
  // Código de 8 dígitos que não é data (CNES de 7 com zero, CEP…): nada.
  assert.equal(detectDateLayout(texto('CEP'), ['69900000', '69915000', '01310100']), null);
  // Amostra pequena demais não decide.
  assert.equal(detectDateLayout(texto('DT_X'), ['20240105']), null);
});

test('a CNV de mês lida da posição certa classifica nos dois formatos', () => {
  const mes = parseCnv(datePartCnvText('mes'));
  assert.equal(mes.categories.length, 12);
  const [ymd] = datePartsFor('ymd');
  const [dmy] = datePartsFor('dmy');
  const classificar = (valor, posicao) => classifyCnv(mes, valor.slice(posicao - 1).slice(0, 2))?.label;
  assert.equal(classificar('20240315', ymd.startPosition), 'Março');
  assert.equal(classificar('15032024', dmy.startPosition), 'Março');
  const ano = parseCnv(datePartCnvText('ano'));
  assert.equal(classifyCnv(ano, '2024')?.label, '2024');
  // Ano de nascimento antigo também entra.
  assert.equal(classifyCnv(ano, '1931')?.label, '1931');
  const semana = parseCnv(datePartCnvText('semana'));
  assert.equal(semana.categories.length, 53);
});
