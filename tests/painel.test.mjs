import assert from 'node:assert/strict';
import test from 'node:test';
import { parseCnv, parseDef, parseTabwinLog, serializeTabwinLog, formatTabwinElapsed } from '../dist/packages/formats/src/index.js';
import {
  PERIODO_EIXO_ID,
  PERIODO_FIELD,
  PainelErro,
  catalogoDoDef,
  catalogoDosCampos,
  categoriasDoEixo,
  compileQueryPlan,
  estadoDoLog,
  estadoInicial,
  executeInMemory,
  logDoPainel,
  nomeBaseDoRecurso,
  specDoPainel,
  subtituloDoPainel,
} from '../dist/packages/core/src/index.js';

// The DEF used for the 2026-10-13 oracle run (docs/reverse-engineering/RE_002).
const TESTE_DEF = [
  ';Teste TabSis oraculo',
  'AC:\\TabWin\\G001\\RD*.DBC',
  'IValor Total,VAL_TOT',
  'IÓbitos,MORTE',
  'LRaça parcial,RACA_COR,1,RACA1.CNV',
  'LSexo,SEXO,1,SEXO.CNV',
  'CCaráter,CAR_INT,1,CARINT.CNV',
  'CRaça parcial,RACA_COR,1,RACA1.CNV',
  'SRaça parcial,RACA_COR,1,RACA1.CNV',
  'XSexo X,SEXO,1,SEXO.CNV',
].join('\r\n');

const row = (seq, label, codes) => `${String(seq).padStart(7)}  ${label.padEnd(50)} ${codes}`;
const CNVS = new Map([
  ['RACA1.CNV', parseCnv(['2 2', row(1, 'Branca', '01'), row(2, 'Parda', '03')].join('\n'))],
  ['SEXO.CNV', parseCnv(['3 1', row(3, 'Ignorado', '0-9'), row(1, 'Masculino', '1'), row(2, 'Feminino', '2,3')].join('\n'))],
  ['CARINT.CNV', parseCnv(['3 2', row(3, 'Ignorado', '00-99'), row(1, 'Eletiva', '01'), row(2, 'Urg/Emerg (Hosp referência)', '02,20')].join('\n'))],
]);
const recursos = {
  conversao: (file) => [...CNVS.keys()].find((name) => nomeBaseDoRecurso(name) === nomeBaseDoRecurso(file)),
  lookup: () => undefined,
};

function catalogo() {
  return catalogoDoDef(parseDef(TESTE_DEF), recursos);
}

test('the panel lists DEF entries in file order, X in all three lists', () => {
  const cat = catalogo();
  assert.equal(cat.titulo, 'Teste TabSis oraculo');
  assert.equal(cat.padraoArquivos, 'C:\\TabWin\\G001\\RD*.DBC');
  assert.deepEqual(cat.linhas.map((e) => e.label), ['Raça parcial', 'Sexo', 'Sexo X']);
  assert.deepEqual(cat.colunas.map((e) => e.label), ['Caráter', 'Raça parcial', 'Sexo X']);
  assert.deepEqual(cat.selecoes.map((e) => e.label), ['Raça parcial', 'Sexo X']);
  assert.deepEqual(cat.incrementos.map((e) => e.label), ['Frequência', 'Valor Total', 'Óbitos']);
  assert.ok(cat.linhas.every((e) => e.disponivel));
});

test('defaults match the TabWin panel when it opens', () => {
  const estado = estadoInicial(catalogo());
  assert.equal(estado.coluna, null);
  assert.deepEqual(estado.incrementos, ['freq']);
  assert.equal(estado.suprimirLinhasZeradas, false);
  assert.equal(estado.suprimirColunasZeradas, true);
  assert.equal(estado.naoClassificados, 'ignorar');
});

test('a missing CNV greys the entry out and says which file is missing', () => {
  const cat = catalogoDoDef(parseDef(TESTE_DEF), { conversao: () => undefined, lookup: () => undefined });
  assert.equal(cat.linhas[0].disponivel, false);
  assert.equal(cat.linhas[0].motivo, 'falta a tabela RACA1.CNV');
  assert.throws(() => specDoPainel(cat, { ...estadoInicial(cat), linha: cat.linhas[0].id }), /falta a tabela RACA1\.CNV/);
});

test('TabWin refusals keep TabWin wording', () => {
  const cat = catalogo();
  const base = estadoInicial(cat);
  assert.throws(
    () => specDoPainel(cat, { ...base, coluna: cat.colunas[0].id, incrementos: ['freq', cat.incrementos[1].id] }),
    (error) => error instanceof PainelErro && error.message === 'Múltiplas colunas é incompatível com múltiplos incrementos',
  );
  assert.throws(
    () => specDoPainel(cat, { ...base, selecoes: [{ eixo: cat.selecoes[0].id, categorias: [] }] }),
    (error) => error instanceof PainelErro && error.message === 'Nenhuma categoria selecionada em Raça parcial',
  );
});

// Synthetic records with the RDAC2401 marginals used in the oracle run.
function registros() {
  const out = [];
  const add = (n, rec) => { for (let i = 0; i < n; i++) out.push({ ...rec }); };
  add(260, { RACA_COR: '01', SEXO: '1', CAR_INT: '01', VAL_TOT: 10, MORTE: 0 });
  add(3040, { RACA_COR: '03', SEXO: '3', CAR_INT: '02', VAL_TOT: 5, MORTE: 1 });
  add(1015, { RACA_COR: '04', SEXO: '3', CAR_INT: '02', VAL_TOT: 1, MORTE: 0 });
  return out;
}

test('Não classificados: Ignorar drops, Incluir adds one row (oracle totals 3300 / 4315)', () => {
  const cat = catalogo();
  const estado = { ...estadoInicial(cat), linha: cat.linhas[0].id };
  const ignorar = executeInMemory(registros(), compileQueryPlan(specDoPainel(cat, estado)), Object.fromEntries(CNVS));
  assert.deepEqual(ignorar.rows.map((r) => r.label), ['Branca', 'Parda']);
  assert.equal(ignorar.recordsAccepted, 3300);
  const incluir = executeInMemory(registros(), compileQueryPlan(specDoPainel(cat, { ...estado, naoClassificados: 'incluir' })), Object.fromEntries(CNVS));
  assert.deepEqual(incluir.rows.map((r) => r.label), ['Branca', 'Parda', 'Não classificados']);
  assert.deepEqual(incluir.cells.map((c) => c[0]), [260, 3040, 1015]);
});

test('selections filter by CNV sequence and several increments become columns', () => {
  const cat = catalogo();
  const estado = {
    ...estadoInicial(cat),
    linha: cat.linhas[1].id,
    incrementos: ['freq', cat.incrementos[1].id, cat.incrementos[2].id],
    selecoes: [{ eixo: cat.selecoes[0].id, categorias: ['1', '2'] }],
    suprimirLinhasZeradas: true,
  };
  const spec = specDoPainel(cat, estado);
  assert.equal(spec.measures.length, 3);
  assert.deepEqual(spec.filters[0].acceptedCategories, ['1', '2']);
  const result = executeInMemory(registros(), compileQueryPlan(spec), Object.fromEntries(CNVS));
  assert.deepEqual(result.rows.map((r) => r.label), ['Masculino', 'Feminino']);
  assert.deepEqual(result.cells, [[260, 2600, 0], [3040, 15200, 3040]]);
  assert.equal(subtituloDoPainel(cat, estado), 'Freqüência Valor Total Óbitos segundo Sexo');
});

test('subtitle with a column reads like TabWin', () => {
  const cat = catalogo();
  const estado = { ...estadoInicial(cat), linha: cat.linhas[1].id, coluna: cat.colunas[0].id };
  assert.equal(subtituloDoPainel(cat, estado), 'Freqüência por Caráter segundo Sexo');
});

test('the log comes out exactly as the TabWin Log window printed it', () => {
  const cat = catalogo();
  const estado = {
    ...estadoInicial(cat),
    linha: cat.linhas[1].id,
    incrementos: ['freq', cat.incrementos[1].id, cat.incrementos[2].id],
    selecoes: [{ eixo: cat.selecoes[0].id, categorias: ['1', '2'] }],
    suprimirLinhasZeradas: true,
  };
  const rotulo = (eixo, id) => categoriasDoEixo(eixo, CNVS, new Map()).find((c) => c.id === id).label;
  const log = logDoPainel(cat, estado, {
    def: 'C:\\TabWin\\G001\\TESTE.DEF', padrao: 'C:\\TabWin\\G001\\RD*.DBC', arquivos: ['RDAC2401.dbc'], registros: 4315, tempo: formatTabwinElapsed(400),
  }, rotulo);
  assert.equal(serializeTabwinLog(log), [
    '[Opções]',
    'DEF=C:\\TabWin\\G001\\TESTE.DEF',
    'PATH=C:\\TabWin\\G001\\RD*.DBC',
    'Linha=Sexo',
    'Incremento=Freqüência',
    'Incremento=Valor Total',
    'Incremento=Óbitos',
    'Suprime_Linhas_Zeradas=true',
    'Suprime_Colunas_Zeradas=true',
    'Não_Classificados=0',
    '[Seleções_Ativas]',
    'Raça parcial: Branca|Parda',
    '[Arquivos]',
    'RDAC2401.dbc',
    'Registros_Processados= 4315',
    'Tempo_Decorrido= 0:00',
    '',
  ].join('\r\n'));
});

test('a saved .TAB restores the panel, and unknown names are reported, not guessed', () => {
  const tab = [
    'NEW',
    'Titulo1=Teste TabSis oraculo',
    'Titulo2=Freqüência por Caráter segundo Sexo',
    '[Opções]',
    'DEF=C:\\TabWin\\G001\\TESTE.DEF',
    'PATH=C:\\TabWin\\G001\\RD*.DBC',
    'Linha=Sexo',
    'Coluna=Caráter',
    'Incremento=Freqüência',
    'Suprime_Linhas_Zeradas=false',
    'Suprime_Colunas_Zeradas=true',
    'Não_Classificados=1',
    '[Seleções_Ativas]',
    'Raça parcial: Branca|Preta',
    'Município: Rio Branco',
    '[Arquivos]',
    'RDAC2401.dbc',
    'Registros_Processados= 4315',
    'Tempo_Decorrido= 0:00',
    '"Sexo";"Eletiva";"Total"',
    '"Masculino";52;52',
  ].join('\r\n');
  const log = parseTabwinLog(tab);
  assert.equal(log.title, 'Teste TabSis oraculo');
  assert.deepEqual(log.files, ['RDAC2401.dbc']);
  assert.equal(log.unclassified, 1);
  const cat = catalogo();
  const { estado, avisos } = estadoDoLog(cat, log, (eixo) => categoriasDoEixo(eixo, CNVS, new Map()));
  assert.equal(estado.linha, cat.linhas[1].id);
  assert.equal(estado.coluna, cat.colunas[0].id);
  assert.equal(estado.naoClassificados, 'incluir');
  assert.deepEqual(estado.selecoes, [{ eixo: cat.selecoes[0].id, categorias: ['1'] }]);
  assert.deepEqual(avisos, ['Categoria "Preta" não existe em Raça parcial.', 'Seleção "Município" não existe neste DEF.']);
});

test('without a DEF the panel lists the file fields and numeric ones as increments', () => {
  const cat = catalogoDosCampos([{ name: 'SEXO', type: 'C' }, { name: 'VAL_TOT', type: 'N' }], (n) => `${n}!`);
  assert.equal(cat.origem, 'campos');
  assert.deepEqual(cat.linhas.map((e) => e.label), ['SEXO!', 'VAL_TOT!']);
  assert.deepEqual(cat.incrementos.map((e) => e.label), ['Frequência', 'VAL_TOT!']);
  const spec = specDoPainel(cat, { ...estadoInicial(cat), selecoes: [{ eixo: 'campo:SEXO', categorias: ['1'] }] });
  assert.deepEqual(spec.filters, [{ field: 'SEXO', acceptedCategories: ['1'] }]);
});

test('Discriminar: uma linha por código só em CNV literal; em CNV curta os códigos ficam fora', () => {
  const literal = parseCnv(['2 2 L', row(1, 'Branca', '01'), row(2, 'Parda', '03')].join('\n'));
  const cnvs = new Map([...CNVS, ['RACAL.CNV', literal]]);
  const def = parseDef(['; literal', 'A*.DBC', 'LRaça literal,RACA_COR,1,RACAL.CNV', 'LRaça curta,RACA_COR,1,RACA1.CNV', 'CRaça literal,RACA_COR,1,RACAL.CNV', 'LSexo,SEXO,1,SEXO.CNV'].join('\n'));
  const cat = catalogoDoDef(def, {
    conversao: (file) => [...cnvs.keys()].find((name) => nomeBaseDoRecurso(name) === nomeBaseDoRecurso(file)),
    lookup: () => undefined,
  });
  const dados = [
    ...Array.from({ length: 3 }, () => ({ RACA_COR: '05', SEXO: '1' })),
    { RACA_COR: '01', SEXO: '1' },
    ...Array.from({ length: 2 }, () => ({ RACA_COR: '02', SEXO: '3' })),
    { RACA_COR: '05', SEXO: '3' },
  ];
  const rodar = (estado) => executeInMemory(dados, compileQueryPlan(specDoPainel(cat, estado)), Object.fromEntries(cnvs));
  const base = { ...estadoInicial(cat), naoClassificados: 'discriminar', suprimirLinhasZeradas: true };

  const lit = rodar({ ...base, linha: cat.linhas[0].id });
  assert.deepEqual(lit.rows.map((r) => r.label), ['Branca', '05', '02']);
  assert.deepEqual(lit.cells.map((c) => c[0]), [1, 4, 2]);

  const curta = rodar({ ...base, linha: cat.linhas[1].id });
  assert.deepEqual(curta.rows.map((r) => r.label), ['Branca']);
  assert.equal(curta.recordsAccepted, 1);

  // Na coluna, Discriminar vira uma coluna "Não classificados" só, como no TabWin.
  const coluna = rodar({ ...base, linha: cat.linhas[2].id, coluna: cat.colunas[0].id });
  assert.deepEqual(coluna.columns.map((c) => c.label), ['Branca', 'Não classificados']);
});

test('o Ano virtual não é a primeira Linha de uma tabela nova', () => {
  const eixo = (id, field) => ({ id, label: id, field, disponivel: true });
  const catalogo = {
    origem: 'campos',
    linhas: [eixo(PERIODO_EIXO_ID, PERIODO_FIELD), eixo('campo:SEXO', 'SEXO')],
    colunas: [], selecoes: [], incrementos: [],
  };
  assert.equal(estadoInicial(catalogo).linha, 'campo:SEXO');
});

test('Seleções com várias categorias: "|" e quebra em 79 caracteres, como no .TAB do TabWin', () => {
  // Gravado pelo TabWin 4.15 na varredura de combinações (2026-10-24, CRD039).
  const texto = [
    '[Seleções_Ativas]',
    'Procedimentos obstétricos: 0303100010 TRAT COMPLICACOES REL PREDOM PUERPERIO',
    '    0310010039 PARTO NORMAL',
    'Raça parcial: Branca|Preta',
    '[Arquivos]',
    'RDAC2401.dbc',
  ].join('\r\n');
  const log = parseTabwinLog(texto);
  assert.deepEqual(log.selections, [
    { label: 'Procedimentos obstétricos', categories: ['0303100010 TRAT COMPLICACOES REL PREDOM PUERPERIO', '0310010039 PARTO NORMAL'] },
    { label: 'Raça parcial', categories: ['Branca', 'Preta'] },
  ]);
  // Junta com "|" e quebra antes de passar de 79 caracteres (LARG001: 79 cabe, 80 quebra).
  assert.match(serializeTabwinLog(log), /\r\nRaça parcial: Branca\|Preta\r\n/);
  assert.match(serializeTabwinLog(log), /\r\nProcedimentos obstétricos: 0303100010 TRAT COMPLICACOES REL PREDOM PUERPERIO\r\n {4}0310010039 PARTO NORMAL\r\n/);
  const municipios = serializeTabwinLog({ increments: [], files: [], selections: [{
    label: 'Município de Residência',
    categories: [' MUNICIPIO IGNORADO - RO', "110001 ALTA FLORESTA D'OESTE", '110002 ARIQUEMES', '110003 CABIXI', '110004 CACOAL', '110005 CEREJEIRAS', '110006 COLORADO DO OESTE'],
  }] }).split('\r\n');
  // Como o TabWin gravou (SONDA000, 2026-10-24).
  assert.deepEqual(municipios.slice(municipios.indexOf('[Seleções_Ativas]') + 1, municipios.indexOf('[Arquivos]')), [
    "Município de Residência:  MUNICIPIO IGNORADO - RO|110001 ALTA FLORESTA D'OESTE",
    '    110002 ARIQUEMES|110003 CABIXI|110004 CACOAL|110005 CEREJEIRAS',
    '    110006 COLORADO DO OESTE',
  ]);
  // Até a primeira categoria muda de linha se "Nome: categoria" passar de 79 (CCNES021).
  const cnes = serializeTabwinLog({ increments: [], files: [], selections: [{
    label: 'OUT. Seguro Próprio /Terceiro', categories: ['Estab.sem Atend.OUTROS Seguro Próprio/Seg.Terceiro'],
  }] });
  assert.match(cnes, /\r\nOUT\. Seguro Próprio \/Terceiro:\r\n {4}Estab\.sem Atend\.OUTROS Seguro Próprio\/Seg\.Terceiro\r\n/);
});
