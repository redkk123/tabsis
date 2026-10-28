import assert from 'node:assert/strict';
import test from 'node:test';
import { cadernoSerieEPerfil } from '../dist/packages/analysis/src/caderno-r.js';

const base = {
  titulo: 'Leishmaniose tegumentar: série e perfil, DF e Entorno × Brasil',
  definicaoDeCaso: ['Incluir Tipo de entrada · CLA_TIPO_N · 1 valor(es)', 'Excluir Evolução "6"'],
  agravo: 'casos novos de leishmaniose tegumentar (forma cutânea)',
  regiao: ['530010', '520060'],
  nomeDaRegiao: 'DF e Entorno',
  arquivos: ['LTANBR16.dbf', 'LTANBR17.dbf'],
  variaveisDoPerfil: [{ campo: 'CS_SEXO', rotulo: 'Sexo' }, { campo: 'NU_IDADE_N', rotulo: 'Faixa etária (anos)' }],
  geradoEm: '28/10/2026',
};

test('o caderno-modelo em R lê os três CSV, define a região e traz série, tendência, perfil e texto', () => {
  const { title, cells } = cadernoSerieEPerfil(base);
  assert.equal(title, base.titulo);
  assert.equal(cells.length, 6);
  assert.ok(cells.every((cell) => cell.runtime === 'r'));
  const codigo = cells.map((cell) => cell.code).join('\n');
  for (const arquivo of ['casos.csv', 'populacao.csv', 'perfil.csv']) assert.match(codigo, new RegExp(`/data/${arquivo.replace('.', '\\.')}`));
  assert.match(codigo, /REGIAO <- c\(\n {2}"530010", "520060"\n\)/);
  assert.match(codigo, /prais_winsten <- function/);
  assert.match(codigo, /chisq\.test/);
  assert.match(codigo, /Metodologia:/);
  // A definição de caso vai como comentário, e aspas no texto não quebram o R.
  assert.match(codigo, /# {3}- Excluir Evolução "6"/);
  assert.match(codigo, /AGRAVO <- "casos novos de leishmaniose tegumentar \(forma cutânea\)"/);
});

test('sem região, o caderno roda só com o Brasil', () => {
  const { cells } = cadernoSerieEPerfil({ ...base, regiao: [], nomeDaRegiao: 'Região' });
  assert.match(cells[0].code, /REGIAO <- character\(0\)/);
  assert.match(cells[1].code, /regiao <- if \(length\(REGIAO\)\) serie\(REGIAO\) else NULL/);
});
