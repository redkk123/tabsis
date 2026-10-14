import assert from 'node:assert/strict';
import test from 'node:test';
import { optionsForRole, parseDef } from '../dist/packages/formats/src/index.js';

const historicalExample = `; Autorização de Internação Hospitalar
Ac:\\tabwin\\RD*.DBF
LCID Capítulos,CID,1,CAUSCAPB.CNV
LHospital,CGC_HOSP,NOME_HOSP,HOSPITAL.DBF
SHospital,CGC_HOSP,NOME_HOSP,HOSPITAL.DBF
LGrupo Proced,PRCD,1,GRUPOPRC.CNV
LMunicípio,MU_IBGE_LO,1,MUNICIPIO.CNV
SMunicípio,MU_IBGE_LO,1,MUNICIPIO.CNV
LNatureza,NATUREZA,1,NATUREZA.CNV
LEspecialidade,ESPECIALID,1,ESPECIAL.CNV
CEspecialidade,ESPECIALID,1,ESPECIAL.CNV
CSexo,SEXO,1,SEXOAIH.CNV
CFaixa Etária (5),COD_IDADE,1,IDADEBAS.CNV
IValor Total,VALOR_TOT
IPermanência,PERMANEN`;

test('parses documented DEF axis, DBF lookup and increment directives', () => {
  const def = parseDef(historicalExample);
  assert.equal(def.description, 'Autorização de Internação Hospitalar');
  assert.equal(def.dataSources[0]?.pattern, 'c:\\tabwin\\RD*.DBF');
  assert.equal(def.options.length, 11);
  assert.equal(def.increments.length, 2);

  const cid = def.options[0];
  assert.equal(cid?.kind, 'conversion');
  assert.equal(cid?.startPosition, 1);
  assert.equal(cid?.conversionFile, 'CAUSCAPB.CNV');

  const hospital = def.options[1];
  assert.equal(hospital?.kind, 'dbf-lookup');
  assert.equal(hospital?.lookupLabelField, 'NOME_HOSP');
  assert.equal(hospital?.lookupFile, 'HOSPITAL.DBF');
});

test('D and T directives expand to their documented roles', () => {
  const def = parseDef(`; roles\nA*.DBF\nDRegião,UF,1,UF.CNV\nTSexo,SEXO,1,SEXO.CNV`);
  assert.deepEqual(optionsForRole(def, 'row').map((x) => x.label), ['Região', 'Sexo']);
  assert.deepEqual(optionsForRole(def, 'column').map((x) => x.label), ['Sexo']);
  assert.deepEqual(optionsForRole(def, 'quad').map((x) => x.label), ['Região', 'Sexo']);
});

test('parses A optional SQL query introduced in TabWin 3.x', () => {
  const def = parseDef(`; sql\nA\\dados\\meudbf*.db?,\\dados\\gerameudbf.sql\nLRegião,UF,1,UF.CNV`);
  assert.equal(def.dataSources[0]?.pattern, '\\dados\\meudbf*.db?');
  assert.equal(def.dataSources[0]?.sqlQuery, '\\dados\\gerameudbf.sql');
});

test('parses grouped-frequency G and retains legacy R', () => {
  const def = parseDef(`; grouped\nA*.DBF\nGQUANTIDADE\nRsaida.rel\nLRegião,UF,1,UF.CNV`);
  assert.equal(def.groupedCountField, 'QUANTIDADE');
  assert.equal(def.reportFile, 'saida.rel');
});

test('X is line, column and selection at once, as the real TabWin 4.15 lists it', () => {
  // Oracle 2026-10-13 (docs/reverse-engineering/RE_002): TESTE.DEF with
  // "XSexo X,SEXO,1,SEXO.CNV" showed "Sexo X" in Linhas, Colunas and
  // Seleções disponíveis, after the L/C/S options declared before it.
  const def = parseDef(`; x\nA*.DBF\nLRaça parcial,RACA_COR,1,RACA1.CNV\nLSexo,SEXO,1,SEXO.CNV\nCCaráter,CAR_INT,1,CARINT.CNV\nSRaça parcial,RACA_COR,1,RACA1.CNV\nXSexo X,SEXO,1,SEXO.CNV`);
  assert.equal(def.unknownLines.length, 0);
  assert.doesNotMatch(def.warnings.join('\n'), /X directive/);
  assert.deepEqual(optionsForRole(def, 'row').map((x) => x.label), ['Raça parcial', 'Sexo', 'Sexo X']);
  assert.deepEqual(optionsForRole(def, 'column').map((x) => x.label), ['Caráter', 'Sexo X']);
  assert.deepEqual(optionsForRole(def, 'selection').map((x) => x.label), ['Raça parcial', 'Sexo X']);
  const x = def.options.at(-1);
  assert.equal(x?.directive, 'X');
  assert.equal(x?.kind, 'conversion');
  assert.equal(x?.conversionFile, 'SEXO.CNV');
});

test('the ? directive names the help file instead of becoming an unknown line', () => {
  const def = parseDef(';Movimento de AIH\nADADOS\\RD*.DBC\n?\\TAB\\RD.HLP\nLSexo,SEXO,1,SEXO.CNV');
  assert.equal(def.helpFile, '\\TAB\\RD.HLP');
  assert.equal(def.unknownLines.length, 0);
});

test('other first-position letters stay as audited unknown lines', () => {
  const def = parseDef('; z\nA*.DBF\nZAlguma coisa,CAMPO,1,Z.CNV\nLRegião,UF,1,UF.CNV');
  assert.equal(def.unknownLines[0]?.directive, 'Z');
  assert.equal(def.options.length, 1);
});

test('texto no terceiro campo com CNV: o TabWin ignora o texto e lê a CNV da posição 1 (RE-004)', () => {
  const def = parseDef(`; contemporary\nA*.DBC\nLSubTp FAEC,FAEC_TP,DS_TPFIN,CNV\\TP_FINAN.CNV`);
  const option = def.options[0];
  assert.equal(option?.kind, 'conversion');
  assert.equal(option?.startPosition, 1);
  assert.equal(option?.conversionFile, 'CNV\\TP_FINAN.CNV');
  assert.equal(option?.ignoredThirdField, 'DS_TPFIN');
});

test('recurso que não é CNV nem DBF continua guardado, sem executar', () => {
  const def = parseDef(`A*.DBC\nLAlgo,CAMPO,DS_X,TABELA.XYZ`);
  assert.equal(def.options[0]?.kind, 'external-lookup');
  assert.equal(def.options[0]?.resourceFile, 'TABELA.XYZ');
});

test('retains unresolved trailing lookup fields from contemporary real DEF records', () => {
  const def = parseDef('LCID Secundário 1,DIAGSEC1,CD_DESCR,DBF\\CID10.DBF,CD_DESCR,DBF\\CID10.DBF');
  const option = def.options[0];
  assert.equal(option?.kind, 'dbf-lookup');
  assert.deepEqual(option?.trailingFields, ['CD_DESCR', 'DBF\\CID10.DBF']);
  assert.match(def.warnings.join('\n'), /2 retained trailing field/);
});

test('linhas-título do CNES não derrubam o DEF: X sem campo e I com vírgula sobrando (RE-004)', () => {
  const def = parseDef([
    'AESTABEL\\ST*.DB?',
    'X* EQUIPES_AC *,    , TITULO , TITULO_REFERENTES_A_EQUIPES_DO_UF',
    'I* ATENDIMIMENTO PRESTADO *, ATEND_PR,',
    'IINTERNAÇÃO/SUS,     AP01CV01',
    'XTipo de Gestão,     TPGESTAO,   1, CNV\\TPGESTAO.CNV',
  ].join('\n'));
  assert.equal(def.options.length, 2);
  assert.equal(def.options[0]?.field, '');
  assert.deepEqual(def.increments.map((increment) => [increment.label, increment.field]), [['* ATENDIMIMENTO PRESTADO *', 'ATEND_PR'], ['INTERNAÇÃO/SUS', 'AP01CV01']]);
});
