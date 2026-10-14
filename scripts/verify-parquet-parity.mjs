#!/usr/bin/env node
/**
 * Prova que o Parquet do TabSis entrega ao motor os MESMOS registros do DBC.
 *
 * Uso: node scripts/verify-parquet-parity.mjs <origem.dbc|.dbf> <convertido.parquet>
 *
 * Compara registro a registro, campo a campo, valor e tipo (texto, número,
 * data, lógico, nulo). Se um único valor divergir, sai com erro e diz onde.
 * Também confere a procedência gravada (nome, SHA-256 e tamanho da origem).
 */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { streamDbcRecords, streamDbfRecords } from '../dist/packages/acquisition/src/dbf-record-stream.js';
import { asyncBufferFromBytes, openParquetDataset, streamParquetRecords } from '../dist/packages/acquisition/src/parquet-source.js';

const [origem, convertido] = process.argv.slice(2);
if (!origem || !convertido) {
  console.error('uso: node scripts/verify-parquet-parity.mjs <origem.dbc> <convertido.parquet>');
  process.exit(1);
}
const bytes = new Uint8Array(await readFile(origem));
// Um resumo por registro, não o registro: o DENGBR25 tem 1,6 milhão deles e
// guardar todos os objetos estouraria a memória antes da comparação.
const serializar = (registro, campos) => JSON.stringify(campos.map((campo) => {
  const valor = registro[campo.name] ?? null;
  return valor instanceof Date ? ['D', valor.getTime()] : [typeof valor, valor];
}));
const resumoDe = (texto) => createHash('sha1').update(texto).digest('base64');
const esperado = [];
let primeiros = [];
let camposOrigem = null;
const resumo = (/\.dbc$/i.test(origem) ? streamDbcRecords : streamDbfRecords)(bytes, ({ records }) => {
  for (const registro of records) {
    camposOrigem ??= Object.keys(registro).map((name) => ({ name }));
    const texto = serializar(registro, camposOrigem);
    esperado.push(resumoDe(texto));
    if (primeiros.length < 3) primeiros.push(texto);
  }
}, { batchSize: 20_000 });

const arquivo = asyncBufferFromBytes(new Uint8Array(await readFile(convertido)));
const dataset = await openParquetDataset(arquivo);
const sha = createHash('sha256').update(bytes).digest('hex');
if (dataset.provenance.sha256 !== sha) throw new Error(`SHA-256 da origem difere: Parquet diz ${dataset.provenance.sha256}, arquivo é ${sha}`);
if (dataset.provenance.name !== path.basename(origem)) throw new Error(`nome original difere: ${dataset.provenance.name}`);
if (JSON.stringify(dataset.header.fields) !== JSON.stringify(resumo.header.fields)) throw new Error('cabeçalho DBF difere');

let indice = 0;
let divergencias = 0;
const campos = dataset.header.fields.map((campo) => ({ name: campo.name }));
await streamParquetRecords(arquivo, dataset, ({ records }) => {
  for (const registro of records) {
    const texto = serializar(registro, campos);
    if (resumoDe(texto) !== esperado[indice] && divergencias++ < 5) {
      console.error(`registro ${indice} difere: Parquet=${texto.slice(0, 400)}`);
      if (indice < primeiros.length) console.error(`                DBC=${primeiros[indice].slice(0, 400)}`);
    }
    indice += 1;
  }
}, { batchSize: 50_000 });
if (indice !== esperado.length) throw new Error(`Parquet tem ${indice} registros, DBC tem ${esperado.length}`);
if (divergencias) throw new Error(`${divergencias} valor(es) divergente(s)`);
console.log(`paridade ok: ${indice} registros × ${dataset.header.fields.length} campos idênticos (${path.basename(origem)} ↔ ${path.basename(convertido)})`);
