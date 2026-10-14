#!/usr/bin/env node
/**
 * Preenche o espelho R2 e regrava o manifesto público.
 *
 * O que ele faz, em ordem: lê a lista declarada de arquivos, baixa cada um do
 * DATASUS pelo mesmo caminho que o aplicativo usa, confere que o pacote chegou
 * inteiro, extrai o `.dbc`, calcula o SHA-256, envia ao bucket e grava a
 * entrada no manifesto.
 *
 * O manifesto sai em `apps/web/public/mirror.json` — **no repositório**, não no
 * bucket. Essa separação é o que sustenta a confiança: se o hash esperado
 * morasse junto do arquivo, quem controla o bucket controlaria os dois, e
 * verificar não provaria nada. No git, cada hash tem histórico datado.
 *
 * O envio usa `wrangler r2 object put`, que já está instalado e autenticado
 * para o Worker. Nenhuma credencial nova.
 *
 * Junto do `.dbc` vai a versão leve em Parquet (scripts/dbc-para-parquet.mjs),
 * com o mesmo nome-base (`DNBR2024.parquet`) e hash próprio no manifesto. Antes
 * de enviar, a paridade é conferida registro a registro; se divergir, o Parquet
 * não sobe e o espelho continua servindo só o DBC. `--sem-parquet` desliga.
 *
 * Uso:
 *   node scripts/sync-mirror.mjs --bucket tabwin-mirror --base https://espelho.tabweb.me
 *   node scripts/sync-mirror.mjs --dry-run          (baixa e calcula, não envia)
 *   node scripts/sync-mirror.mjs --dry-run --so DOINF23.dbc   (um arquivo só)
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { unzipSync } from 'fflate';
import { converter } from './dbc-para-parquet.mjs';

const PROXY = 'https://tabwin-web-datasus-proxy.tabwin-web.workers.dev';
const ORIGEM = 'https://tabweb.me';
const MANIFESTO = 'apps/web/public/mirror.json';
const LISTA = 'docs/product/mirror-files.json';

const argumentos = new Map();
for (let i = 2; i < process.argv.length; i += 1) {
  const chave = process.argv[i];
  if (!chave?.startsWith('--')) continue;
  const proximo = process.argv[i + 1];
  argumentos.set(chave.slice(2), proximo?.startsWith('--') || proximo === undefined ? 'true' : proximo);
}
const ensaio = argumentos.get('dry-run') === 'true';
const semParquet = argumentos.get('sem-parquet') === 'true';
const bucket = argumentos.get('bucket') ?? 'tabwin-mirror';
const base = (argumentos.get('base') ?? '').replace(/\/$/, '');

if (!ensaio && !base) {
  console.error('sync-mirror: informe --base com a URL pública do bucket, ou use --dry-run');
  process.exit(1);
}
if (!fs.existsSync(LISTA)) {
  console.error(`sync-mirror: não achei a lista em ${LISTA}`);
  console.error('sync-mirror: ela declara quais arquivos o espelho guarda.');
  process.exit(1);
}

const postar = async (rota, corpo) => (await fetch(`${PROXY}/${rota}`, {
  method: 'POST',
  headers: { origin: ORIGEM, 'content-type': 'application/x-www-form-urlencoded' },
  body: corpo,
})).json();

/**
 * Espera o pacote existir antes de baixar.
 *
 * O `/prepare` do DATASUS devolve o endereço antes de terminar de escrever o
 * zip; baixar cedo demais traz 404 ou um pacote pela metade.
 */
async function prepararEEsperar(arquivo) {
  const corpo = new URLSearchParams();
  corpo.append('dados[0][arquivo]', arquivo.name);
  corpo.append('dados[0][link]', arquivo.source);
  // O proxy devolve `{ error }` quando o DATASUS estoura o prazo de 30 s, e
  // ele estoura: o preparo do DNBR2024 varia de 11 s a mais de 30. Sem tratar,
  // isso virava "flat is not a function" e escondia a causa real.
  //
  // Três tentativas com espera crescente, porque o preparo é a etapa mais
  // instável do portal e refazê-la custa uma requisição pequena.
  let url;
  for (let tentativa = 1; tentativa <= 3 && !url; tentativa += 1) {
    const resposta = await postar('prepare', corpo);
    if (Array.isArray(resposta)) {
      url = resposta.flat(9).find((valor) => typeof valor === 'string' && valor.startsWith('http'));
    } else if (tentativa === 3) {
      const motivo = resposta?.error?.message ?? JSON.stringify(resposta).slice(0, 120);
      throw new Error(`o preparo falhou: ${motivo}`);
    }
    if (!url && tentativa < 3) await new Promise((r) => setTimeout(r, 5000 * tentativa));
  }
  if (!url) throw new Error('o DATASUS não devolveu URL preparada');

  for (let tentativa = 0; tentativa < 30; tentativa += 1) {
    const sonda = await fetch(url, { headers: { range: 'bytes=0-1' } });
    await sonda.arrayBuffer();
    if (sonda.status !== 404) return url;
    await new Promise((resolver) => setTimeout(resolver, 2000));
  }
  throw new Error('o pacote preparado nunca ficou pronto');
}

/** Baixa o pacote e confere que ele chegou inteiro antes de acreditar nele. */
async function baixarPacote(url) {
  const resposta = await fetch(`${PROXY}/archive?url=${encodeURIComponent(url)}`, {
    headers: { origin: ORIGEM },
  });
  if (!resposta.ok) throw new Error(`download falhou: HTTP ${resposta.status}`);
  const zip = new Uint8Array(await resposta.arrayBuffer());

  // Fim de diretório central: um zip cortado extrairia menos arquivos em
  // silêncio, e o espelho passaria a servir um dado incompleto para sempre.
  const cauda = zip.subarray(Math.max(0, zip.length - 22 - 0xffff));
  const assinatura = [0x50, 0x4b, 0x05, 0x06];
  let inteiro = false;
  for (let i = cauda.length - 4; i >= 0 && !inteiro; i -= 1) {
    inteiro = assinatura.every((byte, j) => cauda[i + j] === byte);
  }
  if (!inteiro) throw new Error('o pacote veio cortado');
  return zip;
}

const so = argumentos.get('so')?.toLowerCase();
const lista = JSON.parse(fs.readFileSync(LISTA, 'utf8'))
  .filter((arquivo) => !so || arquivo.name.toLowerCase() === so);
const entries = [];
const falhas = [];

console.log(`${lista.length} arquivo(s) declarados${ensaio ? ' · ensaio, nada é enviado' : ` · bucket ${bucket}`}\n`);

for (const arquivo of lista) {
  try {
    const url = await prepararEEsperar(arquivo);
    const zip = await baixarPacote(url);
    const conteudo = unzipSync(zip);
    const nomeInterno = Object.keys(conteudo)
      .find((nome) => nome.toLowerCase() === arquivo.name.toLowerCase())
      ?? Object.keys(conteudo)[0];
    const bytes = conteudo[nomeInterno];
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const destino = `${arquivo.path ?? arquivo.name}`;

    const temporario = path.join('.cache', 'mirror', arquivo.name);
    fs.mkdirSync(path.dirname(temporario), { recursive: true });
    fs.writeFileSync(temporario, bytes);
    const enviar = (local, remoto, tipo) => {
      // `shell: true` porque no Windows o `npx` é um `.cmd`, e sem shell o
      // spawn não o encontra — falha com ENOENT sem dizer o porquê.
      execFileSync('npx', ['wrangler', 'r2', 'object', 'put',
        `${bucket}/${remoto}`, '--file', local, '--remote',
        // Nome com conteúdo fixo: o hash muda quando o DATASUS republica, e o
        // manifesto (no git) é que diz qual vale. O objeto pode ficar em cache
        // por um dia sem risco, porque quem baixa confere o hash.
        '--content-type', tipo, '--cache-control', 'public, max-age=86400'],
      { stdio: 'pipe', shell: true });
    };
    if (!ensaio) enviar(temporario, destino, 'application/octet-stream');

    let parquet;
    if (!semParquet) {
      const saida = temporario.replace(/\.(dbc|dbf)$/i, '.parquet');
      const r = await converter(temporario, saida);
      execFileSync(process.execPath, ['scripts/verify-parquet-parity.mjs', temporario, saida], { stdio: 'pipe' });
      const destinoParquet = destino.replace(/\.(dbc|dbf)$/i, '.parquet');
      if (!ensaio) enviar(saida, destinoParquet, 'application/vnd.apache.parquet');
      parquet = { path: destinoParquet, sha256: r.parquetSha256, bytes: r.parquetBytes, rows: r.recordCount, converter: r.converter };
      console.log(`  ${''.padEnd(16)} leve: ${(r.parquetBytes / 1048576).toFixed(1)} MB (${Math.round(r.parquetBytes / bytes.byteLength * 100)}%) · paridade conferida`);
      fs.rmSync(saida, { force: true });
    }
    fs.rmSync(temporario, { force: true });

    entries.push({
      name: arquivo.name,
      path: destino,
      sha256,
      bytes: bytes.byteLength,
      fetchedAt: new Date().toISOString(),
      source: arquivo.source,
      ...(parquet ? { parquet } : {}),
    });
    console.log(`  ${arquivo.name.padEnd(16)} ${(bytes.byteLength / 1048576).toFixed(1)} MB · ${sha256.slice(0, 12)}`);
  } catch (erro) {
    falhas.push(`${arquivo.name}: ${erro instanceof Error ? erro.message : String(erro)}`);
    console.log(`  ${arquivo.name.padEnd(16)} FALHOU — ${erro instanceof Error ? erro.message : erro}`);
  }
}

// Uma falha não apaga o que já estava espelhado: o manifesto novo herda as
// entradas antigas que não foram refeitas nesta execução.
const anterior = fs.existsSync(MANIFESTO)
  ? JSON.parse(fs.readFileSync(MANIFESTO, 'utf8')).entries ?? []
  : [];
const porNome = new Map(anterior.map((entrada) => [entrada.name.toLowerCase(), entrada]));
for (const entrada of entries) porNome.set(entrada.name.toLowerCase(), entrada);

// Ensaio não envia nada, então também não pode prometer nada: um manifesto
// que aponta para um Parquet que não subiu faria o aplicativo pedir um 404.
if (ensaio) {
  console.log(`\n${entries.length} conferido(s) · ensaio: manifesto NÃO regravado`);
  process.exit(falhas.length ? 1 : 0);
}

fs.mkdirSync(path.dirname(MANIFESTO), { recursive: true });
fs.writeFileSync(MANIFESTO, `${JSON.stringify({
  schema: 'tabwin-web.mirror',
  version: 1,
  baseUrl: base || (JSON.parse(fs.existsSync(MANIFESTO) ? fs.readFileSync(MANIFESTO, 'utf8') : '{}').baseUrl ?? ''),
  updatedAt: new Date().toISOString(),
  entries: [...porNome.values()].sort((a, b) => a.name.localeCompare(b.name)),
}, null, 2)}\n`);

console.log(`\n${entries.length} espelhado(s) · ${porNome.size} no manifesto · ${MANIFESTO}`);
if (falhas.length) {
  console.error(`\n${falhas.length} falharam:`);
  for (const falha of falhas) console.error(`  ${falha}`);
  process.exit(1);
}
