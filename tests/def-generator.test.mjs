import assert from 'node:assert/strict';
import test from 'node:test';
import {
  classifyCnv, defFilePattern, generateCnvFromValues, generateDef, optionsForRole, parseCnv, parseDef, serializeCnv,
} from '../dist/packages/formats/src/index.js';

test('Gera DEF: texto vira X com a CNV do campo, número vira Incremento, e o TabSis lê de volta', () => {
  const text = generateDef({
    title: 'RDAC2401.dbc', filePattern: defFilePattern('RDAC2401.dbc'),
    fields: [
      { name: 'SEXO', type: 'C', label: 'Sexo' },
      { name: 'MUNIC_RES', type: 'C', label: 'Município, residência' },
      { name: 'VAL_TOT', type: 'N', label: 'Valor total' },
    ],
  });
  assert.equal(text.split('\r\n')[1], 'ARDAC*.DBC');
  const def = parseDef(text);
  assert.equal(def.description, 'RDAC2401.dbc');
  assert.deepEqual(optionsForRole(def, 'row').map((option) => option.label), ['Sexo', 'Município residência']);
  assert.deepEqual(optionsForRole(def, 'selection').map((option) => option.field), ['SEXO', 'MUNIC_RES']);
  assert.deepEqual(def.increments.map((increment) => increment.field), ['VAL_TOT']);
  assert.throws(() => generateDef({ title: 'x', filePattern: 'X*.DBF', fields: [] }), /ao menos um campo/);
});

test('defFilePattern usa o nome do DATASUS sem os dígitos do período', () => {
  assert.equal(defFilePattern('DOINF23.dbc'), 'DOINF*.DBC');
  assert.equal(defFilePattern('dados.dbf'), 'DADOS*.DBF');
  assert.equal(defFilePattern('2024'), '**.DBF');
});

test('Gera CNV: um código por categoria, curta até 4 posições, e o arquivo salvo classifica igual', () => {
  const cnv = generateCnvFromValues(['2', '1', '3', '1', '', null ?? '']);
  assert.equal(cnv.mode, 'short');
  assert.deepEqual(cnv.categories.map((category) => category.label), ['1', '2', '3']);
  const reread = parseCnv(serializeCnv(cnv));
  assert.equal(classifyCnv(reread, '2')?.sequence, 2);
  const longa = generateCnvFromValues(['120040', '120020']);
  assert.equal(longa.mode, 'literal');
  assert.equal(classifyCnv(parseCnv(serializeCnv(longa)), '120040')?.label, '120040');
  assert.throws(() => generateCnvFromValues(['', '  ']), /não tem valores/);
  assert.throws(() => generateCnvFromValues(['a,b']), /vírgula/);
});

test('x minúsculo no DEF vale como X (o TabWin lista em Linhas, Colunas e Seleções)', () => {
  const def = parseDef([';t', 'AX*.DBF', 'xCausa (minusculo), CAUSABAS, 1, CID10_BR.CNV'].join('\r\n'));
  assert.deepEqual(def.options[0].roles.sort(), ['column', 'row', 'selection']);
});

test('linha de DEF com 3 campos (SIA): vira opção cuja tabela é o 3º campo, sem derrubar o DEF', () => {
  const def = parseDef([';t', 'ADADOS\\PA*.DBC', 'LMantida, PA_MN_IND, 1, CNV/MANT_IND.CNV', 'L + NOME FANTASIA   , TITULO     , LINHA_COMENTARIO_REFERENTE_DADOS'].join('\r\n'));
  assert.equal(def.options.length, 2);
  assert.equal(def.options[1].label, '+ NOME FANTASIA');
  assert.equal(def.options[1].conversionFile, 'LINHA_COMENTARIO_REFERENTE_DADOS');
  assert.match(def.warnings.join('\n'), /3 fields/);
});
