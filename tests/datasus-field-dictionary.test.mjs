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

test('SIH, SIA e CNES: o layout do Informe Técnico de cada arquivo, pelo prefixo', () => {
  assert.equal(datasusFieldEntry('VAL_TOT', 'SIH', 'RD')?.entry.label, 'Valor total da AIH');
  // O informe escreve DI_INTER; o arquivo tem DT_INTER.
  assert.equal(datasusFieldEntry('DT_INTER', 'SIH', 'RD')?.entry.label, 'Data de internação');
  const orgao = datasusFieldEntry('ORGEXPED', 'CNES', 'ST');
  assert.equal(orgao?.entry.label, 'Órgão expedidor do alvará');
  assert.equal(orgao?.entry.values, '1-SES 2-SMS');
  assert.match(orgao?.source ?? '', /Informe Técnico CNES/);
  assert.equal(datasusFieldEntry('PA_INDICA', 'SIA', 'PA')?.entry.values, '0 = não aprovado; 5 = aprovado total; 6 = aprovado parcial');
  // SEQUENCIA quer dizer coisas diferentes no RD e no SP: sem o arquivo, não responde.
  assert.equal(datasusFieldEntry('SEQUENCIA', 'SIH'), undefined);
  assert.ok(datasusFieldEntry('SEQUENCIA', 'SIH', 'SP'));
});
