/**
 * Sorteia as combinações da varredura de Colunas, Incrementos e Seleções (semente
 * fixa: a lista é sempre a mesma) para o robô do TabWin
 * (docs/reverse-engineering/ferramentas/varrer_combos.py).
 *
 * Cada combinação: uma Linha, às vezes uma Coluna, zero a três Incrementos (só um
 * com Coluna — o TabWin recusa "Múltiplas colunas é incompatível com múltiplos
 * incrementos") e às vezes uma Seleção. Para a Seleção não zerar a tabela, o
 * TabSis escolhe categorias com registro entre as 7 primeiras da lista (as que
 * cabem na tela do painel); uma vez ou outra, de propósito, uma vazia.
 * Os números quem calcula é o TabWin; o TabSis só escolhe o que marcar.
 *
 * Uso (depois de npm run build):
 *   node scripts/gerar-combos-varredura.mjs <pasta> <DEF> <dados> <quantidade> <saida.json>
 */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { compileQueryPlan, executeInMemory, categoriasDoEixo, estadoInicial, specDoPainel, withRecordLayout, FREQUENCIA_ID } from '../dist/packages/core/src/index.js';
import { abrirPasta, cp1252 } from './varredura-comum.mjs';

const [pasta, defNome, dadosNome, quantidadeTexto, saidaPath] = process.argv.slice(2);
if (!saidaPath) throw new Error('uso: node scripts/gerar-combos-varredura.mjs <pasta> <DEF> <dados> <quantidade> <saida.json>');
const quantidade = Number(quantidadeTexto);
const texto = cp1252.decode(await readFile(path.join(pasta, defNome)));
const linhasDoTexto = texto.split(/\r?\n/);
const base = await abrirPasta(pasta, dadosNome);
const { def, catalogo } = await base.painel(texto, { carregar: false });

// Sorteio determinístico (mulberry32).
let semente = 20261024;
const aleatorio = () => {
  semente = (semente + 0x6D2B79F5) | 0;
  let t = Math.imul(semente ^ (semente >>> 15), 1 | semente);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const um = (lista) => lista[Math.floor(aleatorio() * lista.length)];
const amostra = (lista, n) => {
  const copia = [...lista];
  const saida = [];
  while (saida.length < n && copia.length) saida.push(copia.splice(Math.floor(aleatorio() * copia.length), 1)[0]);
  return saida;
};

const opcaoDe = (eixo) => def.options.find((o) => `def:${o.sourceLine}:L` === eixo.id || `def:${o.sourceLine}:C` === eixo.id || `def:${o.sourceLine}:S` === eixo.id);
// Linha "X" (vale para Linhas, Colunas e Seleções) vira só a letra do papel:
// no DEF da combinação cada lista do painel tem exatamente uma entrada.
const linhaCrua = (sourceLine, papel) => papel + linhasDoTexto[sourceLine - 1].slice(1);
const tamanhoDoRecurso = async (eixo) => {
  const opcao = opcaoDe(eixo);
  await base.carregarOpcao(opcao);
  const lista = categoriasDoEixo(eixo, base.cnvs, base.lookups);
  return lista?.length ?? Infinity;
};

const linhas = [];
for (const eixo of catalogo.linhas.filter((e) => e.disponivel)) if (await tamanhoDoRecurso(eixo) < Infinity) linhas.push(eixo);
// Coluna com milhares de categorias (municípios) deixa a tabela enorme: até 300.
const colunas = [];
for (const eixo of catalogo.colunas.filter((e) => e.disponivel)) if (await tamanhoDoRecurso(eixo) <= 300) colunas.push(eixo);
const selecoes = [];
for (const eixo of catalogo.selecoes.filter((e) => e.disponivel && e.conversionId)) if (await tamanhoDoRecurso(eixo) <= 400) selecoes.push(eixo);
const incrementos = def.increments;

/** Registros que cada uma das 7 primeiras categorias da Seleção deixa passar. */
async function contagens(eixoSelecao) {
  const lista = categoriasDoEixo(eixoSelecao, base.cnvs, base.lookups).slice(0, 7);
  const { catalogo: cat } = await base.painel(`;x\r\nA${dadosNome}\r\n${linhaCrua(opcaoDe(eixoSelecao).sourceLine, 'S')}\r\n`);
  const sel = cat.selecoes[0];
  // Linha qualquer só para a consulta existir: o próprio campo da seleção, cru.
  const linhaFicticia = { ...estadoInicial(cat) };
  const registry = base.registry();
  return lista.map((categoria, indice) => {
    const spec = specDoPainel({ ...cat, linhas: [{ id: 'x', label: 'x', field: sel.field, disponivel: true }] }, {
      ...linhaFicticia, linha: 'x', incrementos: [FREQUENCIA_ID], selecoes: [{ eixo: sel.id, categorias: [categoria.id] }],
    });
    const r = executeInMemory(base.registros, compileQueryPlan(withRecordLayout(spec, base.layout, registry)), registry);
    const total = r.cells.reduce((s, c) => s + (c[0] ?? 0), 0);
    return { indice, id: categoria.id, rotulo: categoria.label, total };
  });
}

const combos = [];
const vistas = new Set();
for (let tentativa = 0; combos.length < quantidade && tentativa < quantidade * 5; tentativa++) {
  const linha = um(linhas);
  const coluna = colunas.length && aleatorio() < 0.5 ? um(colunas) : null;
  const nInc = Math.min(coluna ? um([0, 1]) : um([0, 1, 2, 3, 3]), incrementos.length);
  const incs = amostra(incrementos, nInc).sort((a, b) => a.sourceLine - b.sourceLine);
  let selecao = null;
  if (selecoes.length && aleatorio() < 0.5) {
    const eixo = um(selecoes);
    const cont = await contagens(eixo);
    const cheias = cont.filter((c) => c.total > 0);
    const vazias = cont.filter((c) => c.total === 0);
    const escolhidas = vazias.length && (aleatorio() < 0.1 || !cheias.length) ? [um(vazias)] : amostra(cheias, um([1, 1, 2]));
    escolhidas.sort((a, b) => a.indice - b.indice);
    selecao = {
      linha: linhaCrua(opcaoDe(eixo).sourceLine, 'S'),
      indices: escolhidas.map((c) => c.indice),
      categorias: escolhidas.map((c) => c.id),
      rotulos: escolhidas.map((c) => c.rotulo),
    };
  }
  const combo = {
    linha: linhaCrua(opcaoDe(linha).sourceLine, 'L'),
    coluna: coluna ? linhaCrua(opcaoDe(coluna).sourceLine, 'C') : null,
    incrementos: incs.map((i) => linhaCrua(i.sourceLine, 'I')),
    selecao,
  };
  const chave = JSON.stringify(combo);
  if (vistas.has(chave)) continue;
  vistas.add(chave);
  combos.push(combo);
}
await writeFile(saidaPath, JSON.stringify(combos, null, 1));
console.log(`${combos.length} combinações → ${saidaPath} (linhas ${linhas.length}, colunas ${colunas.length}, incrementos ${incrementos.length}, seleções ${selecoes.length})`);
