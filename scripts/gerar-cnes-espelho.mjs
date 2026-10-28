#!/usr/bin/env node
/**
 * Cadastro dos estabelecimentos (CNES) para o app: nome, município e
 * coordenadas, um arquivo por UF no espelho R2.
 *
 * Fonte: o `cnes_estabelecimentos.zip` do OpenDataSUS (Ministério da Saúde),
 * https://s3.sa-east-1.amazonaws.com/ckan.saude.gov.br/CNES/cnes_estabelecimentos.zip
 * — um CSV em latin-1, separado por `;`, com uma linha por estabelecimento.
 * O navegador não pode baixá-lo direto (o S3 não manda CORS) e ele tem 180 MB
 * descompactado; por isso sai daqui só o que o app usa, por UF.
 *
 * Cada `cnes/<código da UF>.json` é uma lista de
 * `[cnes (7 dígitos), nome fantasia, município (6 dígitos), latitude, longitude]`,
 * com `null` nas coordenadas que faltam ou caem fora do Brasil. Nada de CNPJ,
 * telefone, e-mail ou endereço: o app não precisa deles.
 *
 * O manifesto com o hash de cada arquivo vai para `apps/web/public/cnes.json`,
 * no repositório (como o `mirror.json`): quem controla o bucket não controla o
 * hash que o app confere.
 *
 * Uso:
 *   node scripts/gerar-cnes-espelho.mjs --csv caminho/cnes_estabelecimentos.csv --data-da-fonte 2025-06-11
 *   node scripts/gerar-cnes-espelho.mjs ... --bucket tabwin-mirror   (também envia ao R2)
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';

const BASE = 'https://pub-41df939070d7465a8513416a16be8f88.r2.dev';
const MANIFESTO = 'apps/web/public/cnes.json';
const SAIDA = '.cache/cnes-espelho';

const argumentos = new Map();
for (let i = 2; i < process.argv.length; i += 1) {
  const chave = process.argv[i];
  if (!chave?.startsWith('--')) continue;
  const proximo = process.argv[i + 1];
  argumentos.set(chave.slice(2), proximo?.startsWith('--') || proximo === undefined ? 'true' : proximo);
}
const csv = argumentos.get('csv');
const dataDaFonte = argumentos.get('data-da-fonte');
const bucket = argumentos.get('bucket');
if (!csv || !dataDaFonte) {
  console.error('Uso: node scripts/gerar-cnes-espelho.mjs --csv cnes_estabelecimentos.csv --data-da-fonte AAAA-MM-DD [--bucket tabwin-mirror]');
  process.exit(2);
}

/** Uma linha do CSV: `;` separa, aspas duplas protegem (e "" é aspa). */
function campos(linha) {
  const saida = [];
  let atual = '';
  let aspas = false;
  for (let i = 0; i < linha.length; i += 1) {
    const c = linha[i];
    if (aspas) {
      if (c === '"' && linha[i + 1] === '"') { atual += '"'; i += 1; }
      else if (c === '"') aspas = false;
      else atual += c;
    } else if (c === '"') aspas = true;
    else if (c === ';') { saida.push(atual); atual = ''; }
    else atual += c;
  }
  saida.push(atual);
  return saida;
}

/** Coordenada dentro do Brasil (com folga), ou nada: 0,0 e trocadas existem no cadastro. */
function coordenada(lat, lon) {
  const y = Number(String(lat).replace(',', '.'));
  const x = Number(String(lon).replace(',', '.'));
  if (!Number.isFinite(y) || !Number.isFinite(x) || y === 0 || x === 0) return [null, null];
  if (y < -34.5 || y > 6 || x < -74.5 || x > -28) return [null, null];
  return [Math.round(y * 1e5) / 1e5, Math.round(x * 1e5) / 1e5];
}

const linhas = fs.readFileSync(csv, 'latin1').split(/\r?\n/);
const cabecalho = campos(linhas[0]);
const coluna = (nome) => {
  const indice = cabecalho.indexOf(nome);
  if (indice < 0) throw new Error(`O CSV não tem a coluna ${nome}`);
  return indice;
};
const C = {
  cnes: coluna('CO_CNES'), uf: coluna('CO_UF'), ibge: coluna('CO_IBGE'),
  fantasia: coluna('NO_FANTASIA'), razao: coluna('NO_RAZAO_SOCIAL'),
  lat: coluna('NU_LATITUDE'), lon: coluna('NU_LONGITUDE'),
};

const porUf = new Map();
let semCoordenada = 0;
for (const linha of linhas.slice(1)) {
  if (!linha.trim()) continue;
  const v = campos(linha);
  const cnes = v[C.cnes].trim().padStart(7, '0');
  const uf = v[C.uf].trim();
  if (!/^\d{7}$/.test(cnes) || !/^\d{2}$/.test(uf)) continue;
  const [lat, lon] = coordenada(v[C.lat], v[C.lon]);
  if (lat === null) semCoordenada += 1;
  const nome = (v[C.fantasia].trim() || v[C.razao].trim()).replace(/\s+/g, ' ');
  const municipio = v[C.ibge].trim().slice(0, 6);
  if (!porUf.has(uf)) porUf.set(uf, []);
  porUf.get(uf).push([cnes, nome, municipio, lat, lon]);
}

fs.mkdirSync(SAIDA, { recursive: true });
const ufs = {};
let total = 0;
for (const [uf, lista] of [...porUf].sort(([a], [b]) => a.localeCompare(b))) {
  lista.sort((a, b) => a[0].localeCompare(b[0]));
  const json = Buffer.from(JSON.stringify(lista));
  const gz = gzipSync(json, { level: 9 });
  fs.writeFileSync(path.join(SAIDA, `${uf}.json.gz`), gz);
  ufs[uf] = { registros: lista.length, bytes: json.length, bytesComprimidos: gz.length, sha256: createHash('sha256').update(json).digest('hex') };
  total += lista.length;
  if (bucket) {
    execFileSync('npx', ['wrangler', 'r2', 'object', 'put', `${bucket}/cnes/${uf}.json`, '--file', path.join(SAIDA, `${uf}.json.gz`),
      '--content-type', 'application/json; charset=utf-8', '--content-encoding', 'gzip', '--cache-control', 'public, max-age=86400', '--remote'], { stdio: 'inherit' });
  }
}

const manifesto = {
  schema: 'tabsis.cnes',
  version: 1,
  baseUrl: BASE,
  fonte: 'Cadastro Nacional de Estabelecimentos de Saúde (CNES), OpenDataSUS, Ministério da Saúde: cnes_estabelecimentos.zip',
  dataDaFonte,
  geradoEm: new Date().toISOString(),
  campos: ['cnes', 'nome', 'municipio', 'latitude', 'longitude'],
  ufs,
};
fs.writeFileSync(MANIFESTO, `${JSON.stringify(manifesto, null, 1)}\n`);
console.log(`${total} estabelecimentos em ${Object.keys(ufs).length} UFs; ${semCoordenada} sem coordenada. Manifesto em ${MANIFESTO}.`);
