/**
 * Compara a varredura do TabWin (uma tabela por variável de Linha, salva em
 * .tab pelo robô de docs/reverse-engineering/ferramentas/varrer_tabwin.py) com
 * o motor do TabSis, montando a mesma consulta pelo painel.
 *
 * Uso (depois de npm run build):
 *   node scripts/comparar-varredura.mjs <registro.jsonl> <pasta saida do TabWin> <pasta G001> <arquivo de dados> [relatorio.md]
 */
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { dbcToDbf, readDbfHeader, readDbfRecords } from '@precisa-saude/datasus-dbc';
import { detectDbfTextEncoding, parseCnv, parseDef, transcodeDbfCp850ToWindows1252 } from '../dist/packages/formats/src/index.js';
import {
  catalogoDoDef, compileQueryPlan, estadoInicial, executeInMemory, lookupDefinitionFromDefOption,
  nomeBaseDoRecurso, specDoPainel, withRecordLayout,
} from '../dist/packages/core/src/index.js';

const [registroPath, saidaDir, g001, dadosNome, relatorioPath] = process.argv.slice(2);
if (!dadosNome) throw new Error('uso: node scripts/comparar-varredura.mjs <registro.jsonl> <saida> <G001> <dados> [relatorio.md]');
const cp1252 = new TextDecoder('windows-1252');

const arquivos = new Map();
for (const pasta of [g001, path.join(g001, 'CNV'), path.join(g001, 'DBF')]) {
  try { for (const nome of await readdir(pasta)) if (!arquivos.has(nome.toLowerCase())) arquivos.set(nome.toLowerCase(), path.join(pasta, nome)); } catch { /* opcional */ }
}
// Dados podem estar numa subpasta (SIA\DADOS, CNES\ESTABEL): caminho relativo à pasta.
const relativo = path.join(g001, dadosNome.replace(/\\/g, '/'));
const dadosPath = (await readFile(relativo).then(() => true, () => false)) ? relativo : arquivos.get(dadosNome.toLowerCase());
let dadosBytes = new Uint8Array(await readFile(dadosPath));
if (/\.dbc$/i.test(dadosPath)) dadosBytes = dbcToDbf(dadosBytes);
const layout = readDbfHeader(dadosBytes).fields.map((f) => ({ field: f.name, type: f.type, length: f.length, decimals: f.decimalCount }));
const registros = [];
for await (const r of readDbfRecords(dadosBytes)) registros.push(r);

const cnvs = new Map();
const lookups = new Map();
async function carregarCnv(nome) {
  const chave = nomeBaseDoRecurso(nome);
  if (!cnvs.has(chave)) {
    const caminho = arquivos.get(chave);
    if (!caminho) return undefined;
    cnvs.set(chave, parseCnv(cp1252.decode(await readFile(caminho)), { strict: false }));
  }
  return chave;
}

/** Linhas da tabela salva pelo TabWin: depois do cabeçalho, até "Total". */
function lerTab(texto) {
  const linhas = texto.split(/\r?\n/);
  const inicio = linhas.findIndex((l) => /^".*";".*"/.test(l));
  const saida = [];
  for (const l of linhas.slice(inicio + 1)) {
    const m = /^"((?:[^"]|"")*)";(.*)$/.exec(l);
    if (!m) continue;
    const rotulo = m[1].replace(/""/g, '"');
    const valores = m[2].split(';').map((v) => Number(v.replace(',', '.')));
    if (rotulo === 'Total') return { linhas: saida, total: valores[0] };
    saida.push([rotulo, valores[0]]);
  }
  return { linhas: saida, total: undefined };
}

// Rótulo de lookup é "código nome": compara pelo código (o TabWin converte o CP850 do jeito dele).
// …e sem aspas internas, como o .tab que o TabWin e o TabSis gravam.
// Rótulo de tabela DBF ("código nome"): compara pelo código. O TabWin lê o DBF
// como Windows-1252 mesmo quando ele está em UTF-8 ("IMPORTAÃÃO") e deixa o
// espaço da chave; o TabSis mostra o nome certo. Isso não muda contagem.
const chaveRotulo = (rotulo) => {
  const codigo = /^(\d{2,})\s/.exec(rotulo);
  // Sem os caracteres fora do ASCII: o TabWin mostra o CP850 lido como
  // Windows-1252 ("SÝndrome"), o TabSis o nome certo ("Síndrome").
  return codigo ? codigo[1] : rotulo.replace(/"/g, '').replace(/[^\x20-\x7e]/g, '').trim();
};

const entradas = (await readFile(registroPath, 'utf8')).trim().split('\n').map((l) => JSON.parse(l));
const vistos = new Map();
for (const e of entradas) vistos.set(e.indice, e); // a última tentativa vale
let iguais = 0;
const diferentes = [];
const semTab = [];
for (const e of [...vistos.values()].sort((a, b) => a.indice - b.indice)) {
  if (!e.ok) { semTab.push(e); continue; }
  const texto = cp1252.decode(await readFile(path.join(saidaDir, `${e.nome}.tab`)));
  const tabwin = lerTab(texto);
  const def = parseDef(`;x\r\nA${dadosNome}\r\n${e.linha}\r\n`);
  for (const opcao of def.options) {
    if (opcao.kind === 'conversion') await carregarCnv(opcao.conversionFile);
    if (opcao.kind === 'dbf-lookup') {
      const nome = nomeBaseDoRecurso(opcao.lookupFile);
      if (!lookups.has(nome) && arquivos.get(nome)) {
        let bytes = new Uint8Array(await readFile(arquivos.get(nome)));
        if (detectDbfTextEncoding(bytes) === 'cp850') bytes = transcodeDbfCp850ToWindows1252(bytes);
        const recs = [];
        for await (const r of readDbfRecords(bytes)) recs.push(r);
        lookups.set(nome, lookupDefinitionFromDefOption(opcao, recs));
      }
    }
  }
  const recursos = {
    conversao: (f) => (cnvs.has(nomeBaseDoRecurso(f)) ? nomeBaseDoRecurso(f) : undefined),
    lookup: (f) => (lookups.has(nomeBaseDoRecurso(f)) ? nomeBaseDoRecurso(f) : undefined),
  };
  const catalogo = catalogoDoDef(def, recursos);
  const registry = { ...Object.fromEntries(cnvs), ...Object.fromEntries(lookups) };
  let tabsis;
  try {
    const estado = { ...estadoInicial(catalogo), linha: catalogo.linhas[0].id, suprimirLinhasZeradas: false, suprimirColunasZeradas: true, naoClassificados: 'ignorar' };
    const spec = withRecordLayout(specDoPainel(catalogo, estado), layout, registry);
    const r = executeInMemory(registros, compileQueryPlan(spec), registry);
    tabsis = {
      linhas: r.rows.map((row, i) => [row.label, r.cells[i][0]]),
      // Como o app e a exportação: linha-subtotal entra no Total só com o que caiu direto nela.
      total: r.rows.reduce((s, row, i) => s + (row.excludeFromTotal ? (row.directTotal?.[0] ?? 0) : r.cells[i][0]), 0),
    };
  } catch (erro) {
    diferentes.push({ e, motivo: `TabSis recusou: ${erro.message}` });
    continue;
  }
  const a = tabwin.linhas.map(([l, v]) => [chaveRotulo(l), v]);
  const b = tabsis.linhas.map(([l, v]) => [chaveRotulo(l), v]);
  if (JSON.stringify(a) === JSON.stringify(b) && tabwin.total === tabsis.total) { iguais++; continue; }
  const detalhes = [];
  for (let i = 0; i < Math.max(a.length, b.length) && detalhes.length < 6; i++) {
    if (JSON.stringify(a[i]) !== JSON.stringify(b[i])) detalhes.push(`linha ${i + 1}: TabWin ${JSON.stringify(a[i])} · TabSis ${JSON.stringify(b[i])}`);
  }
  diferentes.push({ e, motivo: `total TabWin ${tabwin.total}, TabSis ${tabsis.total}; ${a.length} × ${b.length} linhas`, detalhes });
}
const rotuloDe = (e) => e.linha.slice(1).split(',')[0].trim();
const relatorio = [
  `# Varredura ${path.basename(registroPath, '.jsonl')} — ${dadosNome}`,
  '',
  `- Variáveis tabuladas no TabWin: ${vistos.size - semTab.length} de ${vistos.size}`,
  `- **Iguais ao TabWin: ${iguais}**`,
  `- Diferentes: ${diferentes.length}`,
  `- Sem tabela do TabWin (erro ou recusa dele): ${semTab.length}`,
  '',
  ...(diferentes.length ? ['## Diferentes', '', ...diferentes.flatMap(({ e, motivo, detalhes }) => [`- **${rotuloDe(e)}** (\`${e.linha.trim()}\`): ${motivo}`, ...(detalhes ?? []).map((d) => `  - ${d}`)])] : []),
  ...(semTab.length ? ['', '## Sem tabela do TabWin', '', ...semTab.map((e) => `- ${rotuloDe(e)} (\`${e.linha.trim()}\`)`)] : []),
].join('\n');
console.log(relatorio);
if (relatorioPath) await writeFile(relatorioPath, relatorio + '\n');
