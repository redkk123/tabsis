/**
 * Compara a varredura de combinações (Linha × Coluna, vários Incrementos,
 * Seleções) do TabWin real com o TabSis. Para cada .tab salvo pelo robô
 * (varrer_combos.py), monta o mesmo DEF e o mesmo painel no TabSis, grava o
 * .tab do TabSis pelo mesmo exportador do aplicativo e compara os dois
 * arquivos: título, log (Linha, Coluna, Incremento, Seleções_Ativas) e a matriz
 * célula a célula, com o Total.
 *
 * Uso (depois de npm run build):
 *   node scripts/comparar-combos.mjs <registro.jsonl> <saida do TabWin> <pasta> <dados> [relatorio.md]
 */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { serializeTabwinLog } from '../dist/packages/formats/src/index.js';
import {
  categoriasDoEixo, compileQueryPlan, estadoInicial, executeInMemory, FREQUENCIA_ID, logDoPainel,
  specDoPainel, subtituloDoPainel, withRecordLayout,
} from '../dist/packages/core/src/index.js';
import { tabulationToTabwinTab } from '../dist/packages/export/src/tabwin-formats.js';
import { abrirPasta, cp1252 } from './varredura-comum.mjs';

const [registroPath, saidaDir, pasta, dadosNome, relatorioPath] = process.argv.slice(2);
if (!dadosNome) throw new Error('uso: node scripts/comparar-combos.mjs <registro.jsonl> <saida> <pasta> <dados> [relatorio.md]');
const pastaTabwin = path.basename(pasta.replace(/\/+$/, ''));
const base = await abrirPasta(pasta, dadosNome);
const dadosArquivo = dadosNome.replace(/\//g, '\\').split('\\').pop();

// Rótulo "código nome": compara pelo código; fora do ASCII não conta (o TabWin
// mostra CP850 lido como Windows-1252). Mesma regra da varredura de Linhas.
const chaveRotulo = (rotulo) => {
  const codigo = /^(\d{2,})\s/.exec(rotulo);
  return codigo ? codigo[1] : rotulo.replace(/"/g, '').replace(/[^\x20-\x7e]/g, '').trim();
};
const ascii = (texto) => texto.replace(/[^\x20-\x7e]/g, '').trimEnd();

/** O .tab em partes: cabeçalho (título e log) e matriz. */
function partes(texto) {
  const linhas = texto.split(/\r?\n/).filter((l) => l !== '');
  const inicio = linhas.findIndex((l) => l.startsWith('"'));
  const cabecalho = linhas.slice(0, inicio)
    .filter((l) => !/^(Tempo_Decorrido|DEF|PATH|Titulo1)=/.test(l))
    .map(ascii);
  // Aspas por dentro o TabWin tira ao salvar; um ';' no rótulo parte a célula
  // igual nos dois arquivos (o pedaço que não é número compara como texto).
  const matriz = linhas.slice(inicio).map((l) => l.split(';').map((c) => (
    c.startsWith('"') ? chaveRotulo(c.slice(1, -1)) : c === '' || Number.isNaN(Number(c.replace(',', '.'))) ? chaveRotulo(c) : Number(c.replace(',', '.')))));
  return { cabecalho, matriz };
}

function iguaisCelula(a, b) {
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) < 0.0051;
  return a === b;
}

const entradas = (await readFile(registroPath, 'utf8')).trim().split('\n').map((l) => JSON.parse(l));
const vistos = new Map();
for (const e of entradas) vistos.set(e.indice, e);
let iguais = 0;
const diferentes = [];
const semTab = [];
const resumo = (e) => [
  e.linha.slice(1).split(',')[0].trim(),
  e.coluna ? `× ${e.coluna.slice(1).split(',')[0].trim()}` : '',
  e.incrementos.length ? `[${e.incrementos.map((i) => i.slice(1).split(',')[0].trim()).join(' + ')}]` : '[Frequência]',
  e.selecao ? `onde ${e.selecao.linha.slice(1).split(',')[0].trim()} = ${e.selecao.rotulos.join(' | ') || `#${e.selecao.indices.join(',')}`}` : '',
].filter(Boolean).join(' ');

for (const e of [...vistos.values()].sort((a, b) => a.indice - b.indice)) {
  if (!e.ok) { semTab.push(e); continue; }
  const tabwinTexto = cp1252.decode(await readFile(path.join(saidaDir, `${e.nome}.tab`)));
  const corpo = [...e.incrementos, e.linha, ...(e.coluna ? [e.coluna] : []), ...(e.selecao ? [e.selecao.linha] : [])];
  const defTexto = `;Varredura TabSis ${e.nome}\r\nA${dadosNome}\r\n${corpo.join('\r\n')}\r\n`;
  let tabsisTexto;
  try {
    const { catalogo } = await base.painel(defTexto);
    const estado = {
      ...estadoInicial(catalogo),
      linha: catalogo.linhas[0].id,
      coluna: e.coluna ? catalogo.colunas[0].id : null,
      incrementos: e.incrementos.length ? catalogo.incrementos.slice(1).map((i) => i.id) : [FREQUENCIA_ID],
      // Sondas escritas à mão trazem só o índice na lista do painel.
      selecoes: e.selecao ? [{
        eixo: catalogo.selecoes[0].id,
        categorias: e.selecao.categorias.length ? e.selecao.categorias
          : e.selecao.indices.map((i) => categoriasDoEixo(catalogo.selecoes[0], base.cnvs, base.lookups)[i].id),
      }] : [],
      suprimirLinhasZeradas: false,
      suprimirColunasZeradas: true,
      naoClassificados: 'ignorar',
    };
    const registry = base.registry();
    const spec = withRecordLayout(specDoPainel(catalogo, estado), base.layout, registry);
    const r = executeInMemory(base.registros, compileQueryPlan(spec), registry);
    const rotuloDaCategoria = (eixo, id) => categoriasDoEixo(eixo, base.cnvs, base.lookups)?.find((c) => c.id === id)?.label ?? id;
    const log = serializeTabwinLog(logDoPainel(catalogo, estado, {
      def: `C:\\TabWin\\${pastaTabwin}\\0VZ${String(e.indice).padStart(3, '0')}.DEF`,
      padrao: `C:\\TabWin\\${pastaTabwin}\\${dadosNome}`,
      arquivos: [dadosArquivo],
      registros: base.registros.length,
      tempo: '0:00',
    }, rotuloDaCategoria));
    // Como o aplicativo (showRowTotalColumn): coluna Total com Colunas, um incremento e 2+ colunas.
    const rowTotalColumn = Boolean(spec.columns) && !spec.measures?.length && r.columns.length >= 2;
    tabsisTexto = tabulationToTabwinTab(r, {
      rowLabel: catalogo.linhas[0].label,
      title: catalogo.titulo ?? '',
      subtitle: subtituloDoPainel(catalogo, estado),
      log,
      rowTotalColumn,
    });
  } catch (erro) {
    diferentes.push({ e, motivo: `TabSis recusou: ${erro.message}` });
    continue;
  }
  const a = partes(tabwinTexto);
  const b = partes(tabsisTexto);
  const detalhes = [];
  for (let i = 0; i < Math.max(a.cabecalho.length, b.cabecalho.length) && detalhes.length < 3; i++) {
    if (a.cabecalho[i] !== b.cabecalho[i]) detalhes.push(`cabeçalho: TabWin ${JSON.stringify(a.cabecalho[i])} · TabSis ${JSON.stringify(b.cabecalho[i])}`);
  }
  for (let i = 0; i < Math.max(a.matriz.length, b.matriz.length) && detalhes.length < 8; i++) {
    const x = a.matriz[i] ?? [];
    const y = b.matriz[i] ?? [];
    if (x.length !== y.length || x.some((c, j) => !iguaisCelula(c, y[j]))) {
      detalhes.push(`matriz linha ${i + 1}: TabWin ${JSON.stringify(x).slice(0, 220)} · TabSis ${JSON.stringify(y).slice(0, 220)}`);
    }
  }
  if (!detalhes.length) { iguais++; continue; }
  diferentes.push({ e, motivo: `${a.matriz.length} × ${b.matriz.length} linhas, ${a.matriz[0]?.length} × ${b.matriz[0]?.length} colunas`, detalhes });
}

const relatorio = [
  `# Varredura de combinações ${path.basename(registroPath, '.jsonl')} — ${dadosNome}`,
  '',
  `- Combinações tabuladas no TabWin: ${vistos.size - semTab.length} de ${vistos.size}`,
  `  - com Coluna: ${[...vistos.values()].filter((e) => e.ok && e.coluna).length}; com 2+ Incrementos: ${[...vistos.values()].filter((e) => e.ok && e.incrementos.length > 1).length}; com Seleção: ${[...vistos.values()].filter((e) => e.ok && e.selecao).length}`,
  `- **Iguais ao TabWin (título, log e cada célula): ${iguais}**`,
  `- Diferentes: ${diferentes.length}`,
  `- Sem tabela do TabWin: ${semTab.length}`,
  '',
  ...(diferentes.length ? ['## Diferentes', '', ...diferentes.flatMap(({ e, motivo, detalhes }) => [`- **${e.nome}** ${resumo(e)}: ${motivo}`, ...(detalhes ?? []).map((d) => `  - ${d}`)])] : []),
  ...(semTab.length ? ['', '## Sem tabela do TabWin', '', ...semTab.map((e) => `- ${e.nome} ${resumo(e)}${e.motivo ? ` — ${e.motivo}` : ''}`)] : []),
].join('\n');
console.log(relatorio);
if (relatorioPath) await writeFile(relatorioPath, relatorio + '\n');
