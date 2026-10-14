import assert from 'node:assert/strict';
import test from 'node:test';
import { datasusDictionaryCount, datasusFieldEntry } from '../dist/packages/formats/src/index.js';

test('dicionário do SIM explica as siglas do DEF de óbitos com a fonte oficial', () => {
  const nova = datasusFieldEntry('STDONOVA', 'SIM');
  assert.equal(nova?.entry.label, 'DO nova');
  assert.equal(nova?.entry.values, '1 – Sim; 0 – Não');
  assert.match(nova?.source ?? '', /Estrutura do SIM/);
  assert.match(datasusFieldEntry('difdata', 'SIM')?.entry.description ?? '', /recebimento original/);
});

test('SEXO tem códigos diferentes no SIM e no SINASC: sem o sistema, não escolhe por você', () => {
  assert.match(datasusFieldEntry('SEXO', 'SIM')?.entry.values ?? '', /M ou 1/);
  assert.match(datasusFieldEntry('SEXO', 'SINASC')?.entry.values ?? '', /0 – Ignorado; 1 – Masculino/);
  assert.equal(datasusFieldEntry('SEXO'), undefined);
  // Campo que só um dicionário tem responde mesmo sem o sistema.
  assert.equal(datasusFieldEntry('APGAR5')?.entry.label, 'Apgar no 5º minuto');
});

test('campo que o dicionário oficial não descreve fica sem explicação, não com um palpite', () => {
  assert.equal(datasusFieldEntry('NUDIASOBIN', 'SIM'), undefined);
  assert.equal(datasusFieldEntry('KOTELCHUCK', 'SINASC'), undefined);
  assert.ok(datasusDictionaryCount('SIM') > 80);
  assert.ok(datasusDictionaryCount('SINASC') >= 30);
});
