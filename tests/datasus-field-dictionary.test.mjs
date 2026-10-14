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

test('SINAN: campos da ficha de notificação, comuns a todos os agravos', () => {
  const sexo = datasusFieldEntry('CS_SEXO', 'SINAN');
  assert.equal(sexo?.entry.values, 'M – Masculino; F – Feminino; I – Ignorado');
  assert.match(sexo?.source ?? '', /SINAN NET/);
  assert.equal(datasusFieldEntry('TP_NOT', 'SINAN')?.entry.label, 'Tipo de notificação');
  assert.match(datasusFieldEntry('NU_IDADE_N', 'SINAN')?.entry.description ?? '', /4018 = dezoito anos/);
  // Campo do agravo não está na ficha: sem o prefixo do arquivo, não se sabe o agravo.
  assert.equal(datasusFieldEntry('FORMACLINI', 'SINAN'), undefined);
});

test('SINAN: dicionário do agravo pelo prefixo do arquivo', () => {
  const forma = datasusFieldEntry('FORMACLINI', 'SINAN', 'HANS');
  assert.match(forma?.entry.values ?? '', /4 – V \(Virchowiana\)/);
  assert.match(forma?.source ?? '', /HANSN_DIC_DADOS/);
  assert.match(datasusFieldEntry('CLASSI_FIN', 'SINAN', 'DENG')?.entry.values ?? '', /Dengue grave/);
  assert.equal(datasusFieldEntry('CLASSI_FIN', 'SINAN', 'CHIK')?.source, datasusFieldEntry('CLASSI_FIN', 'SINAN', 'DENG')?.source);
  assert.equal(datasusFieldEntry('viol_sexu', 'SINAN', 'viol')?.entry.label, 'Tipo de violência: Violência sexual');
  assert.match(datasusFieldEntry('TPESQUEMA', 'SINAN', 'SIFG')?.entry.values ?? '', /Penicilina/);
  assert.ok(datasusFieldEntry('TRATAMENTO', 'SINAN', 'TUBE'));
  assert.ok(datasusFieldEntry('SIN_ICTERI', 'SINAN', 'SIFC') ?? datasusFieldEntry('CLI_ICTERI', 'SINAN', 'SIFC'));
  // Nome do PDF (com acento, longo ou quebrado) chega ao campo do DBF.
  assert.equal(datasusFieldEntry('AGRAVDROGAS', 'SINAN', 'TUBE')?.entry, datasusFieldEntry('AGRAVDROGA', 'SINAN', 'TUBE')?.entry);
  assert.equal(datasusFieldEntry('PETÉQUIA_N', 'SINAN', 'DENG')?.entry, datasusFieldEntry('PETEQUIA_N', 'SINAN', 'DENG')?.entry);
  assert.equal(datasusFieldEntry('REL_IRMÃO', 'SINAN', 'VIOL')?.entry.label, 'Provável autor: Irmão(ã)');
  // A ficha também tem CLASSI_FIN, sem os códigos: o agravo vem antes.
  assert.match(datasusFieldEntry('ZONA', 'SINAN', 'VIOL')?.entry.values ?? '', /Periurbana/);
  assert.notEqual(datasusFieldEntry('CLASSI_FIN', 'SINAN', 'DENG')?.entry, datasusFieldEntry('CLASSI_FIN', 'SINAN')?.entry);
  // Campo da ficha continua respondendo com o prefixo de um agravo.
  assert.equal(datasusFieldEntry('TP_NOT', 'SINAN', 'HANS')?.entry.label, 'Tipo de notificação');
  // Agravo sem dicionário transcrito: só a ficha.
  assert.equal(datasusFieldEntry('FORMACLINI', 'SINAN', 'MALA'), undefined);
});
