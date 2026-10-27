import assert from 'node:assert/strict';
import test from 'node:test';
import {
  casaDefinicao,
  descreverDefinicao,
  lerDefinicao,
  lerRegras,
  previaDeCaso,
} from '../dist/packages/analysis/src/definicao-caso.js';

test('Chagas: B57 entra inteiro, B56 (doença do sono) fica de fora', () => {
  const chagas = lerDefinicao('B57', '');
  for (const valor of ['B57', 'B570', 'B575', 'b57.2', ' B573 ']) assert.equal(casaDefinicao(chagas, valor), true, valor);
  for (const valor of ['B56', 'B560', 'B58', 'A57', '', 'B5']) assert.equal(casaDefinicao(chagas, valor), false, valor);
});

test('faixa compara o começo do código com cada ponta', () => {
  const dengue = lerDefinicao('A90-A91', '');
  for (const valor of ['A90', 'A900', 'A91X', 'A919']) assert.equal(casaDefinicao(dengue, valor), true, valor);
  for (const valor of ['A89', 'A92', 'A9']) assert.equal(casaDefinicao(dengue, valor), false, valor);
  assert.equal(casaDefinicao(lerDefinicao('B570 - B572', ''), 'B573'), false);
});

test('excluir vale por cima de incluir; sem incluir, só exclui', () => {
  const tripSemSono = lerDefinicao('B56-B57', 'B56');
  assert.equal(casaDefinicao(tripSemSono, 'B571'), true);
  assert.equal(casaDefinicao(tripSemSono, 'B561'), false);
  assert.equal(casaDefinicao(lerDefinicao('', 'R99'), 'I219'), true);
  assert.equal(casaDefinicao(lerDefinicao('', 'R99'), 'R99'), false);
});

test('entrada inválida é recusada com uma frase que diz o que fazer', () => {
  assert.throws(() => lerRegras('B57-B58-B59'), /Faixa inválida/);
  assert.throws(() => lerRegras('B575-B570'), /Faixa invertida/);
  assert.throws(() => lerRegras('B5#'), /caracteres/);
  assert.deepEqual(lerRegras('B57, A90;A91\nB55*').map((regra) => regra.inicio), ['B57', 'A90', 'A91', 'B55']);
});

test('a prévia conta o que entra, o que a exclusão tirou e regras que não acharam nada', () => {
  const contagens = [
    { valor: 'B570', registros: 2 },
    { valor: 'B572', registros: 10 },
    { valor: 'B560', registros: 4 },
    { valor: 'I219', registros: 100 },
  ];
  const previa = previaDeCaso(lerDefinicao('B56-B57, Z99', 'B56'), contagens);
  assert.deepEqual(previa.entram, [{ valor: 'B572', registros: 10 }, { valor: 'B570', registros: 2 }]);
  assert.equal(previa.registrosQueEntram, 12);
  assert.equal(previa.registrosQueFicamFora, 104);
  assert.deepEqual(previa.excluidos, [{ valor: 'B560', registros: 4 }]);
  assert.deepEqual(previa.regrasSemCasamento, ['Z99']);
  assert.equal(descreverDefinicao(lerDefinicao('B57', 'B56')), 'B57, sem B56');
});
