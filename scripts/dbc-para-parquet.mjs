#!/usr/bin/env node
/**
 * Converte um DBC (ou DBF) do DATASUS para o formato leve do TabSis: Parquet.
 *
 * Uso:
 *   node scripts/dbc-para-parquet.mjs <entrada.dbc> [saida.parquet]
 *
 * A saída mantém o NOME original (RDAC2401.dbc → RDAC2401.parquet) e leva nos
 * metadados o cabeçalho DBF e a procedência (nome, SHA-256, bytes) do arquivo
 * de origem. Cada campo vai com o tipo que o leitor de DBF devolve — texto
 * (VARCHAR), número (DOUBLE), inteiro (INTEGER), data (DATE), lógico
 * (BOOLEAN) —, para que o motor receba exatamente os mesmos registros.
 * Conferir com: node scripts/verify-parquet-parity.mjs <entrada.dbc> <saida.parquet>
 */
import { createHash } from 'node:crypto';
import { readFile, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { DuckDBInstance, dateValue } from '@duckdb/node-api';
import { streamDbcRecords, streamDbfRecords } from '../dist/packages/acquisition/src/dbf-record-stream.js';
import { PARQUET_DBF_HEADER_KEY, PARQUET_SOURCE_KEY, headerToJson } from '../dist/packages/acquisition/src/parquet-source.js';

export const CONVERSOR = 'tabsis-dbc-para-parquet/1';
const TIPOS = { C: 'VARCHAR', N: 'DOUBLE', F: 'DOUBLE', I: 'INTEGER', D: 'DATE', L: 'BOOLEAN' };

function sqlId(nome) { return `"${nome.replace(/"/g, '""')}"`; }
function sqlStr(texto) { return `'${texto.replace(/'/g, "''")}'`; }

export async function converter(entrada, saida) {
  const bytes = new Uint8Array(await readFile(entrada));
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const ehDbc = /\.dbc$/i.test(entrada);
  const nome = path.basename(entrada);
  const temporario = `${saida}.duckdb`;
  await rm(temporario, { force: true });
  await rm(saida, { force: true });

  const instancia = await DuckDBInstance.create(temporario);
  const conexao = await instancia.connect();
  let appender = null;
  let campos = [];
  let gravados = 0;
  const consumir = ({ records }) => {
    for (const registro of records) {
      for (const campo of campos) {
        const valor = registro[campo.name];
        if (valor === null || valor === undefined) { appender.appendNull(); continue; }
        switch (campo.type) {
          case 'C': appender.appendVarchar(String(valor)); break;
          case 'N': case 'F': appender.appendDouble(Number(valor)); break;
          case 'I': appender.appendInteger(Number(valor)); break;
          case 'D': appender.appendDate(dateValue(Math.round(valor.getTime() / 86_400_000))); break;
          case 'L': appender.appendBoolean(Boolean(valor)); break;
          default: throw new Error(`tipo de campo DBF não previsto: ${campo.type} (${campo.name})`);
        }
      }
      appender.endRow();
      gravados += 1;
    }
  };

  // O cabeçalho vem do próprio leitor, antes do primeiro lote.
  const { readDbcMetadata, readDbfHeader } = await import('@precisa-saude/datasus-dbc');
  const header = ehDbc
    ? readDbfHeader(bytes.subarray(0, readDbcMetadata(bytes).headerSize))
    : readDbfHeader(bytes);
  campos = header.fields;
  await conexao.run(`CREATE TABLE t (${campos.map((c) => `${sqlId(c.name)} ${TIPOS[c.type] ?? 'VARCHAR'}`).join(', ')})`);
  appender = await conexao.createAppender('t');
  const opcoes = { batchSize: 20_000 };
  const resumo = ehDbc ? streamDbcRecords(bytes, consumir, opcoes) : streamDbfRecords(bytes, consumir, opcoes);
  appender.flushSync();
  appender.closeSync();
  if (resumo.recordsEmitted !== gravados) throw new Error('contagem de registros divergiu durante a conversão');

  const fonte = { name: nome, sha256, bytes: bytes.length, recordCount: gravados, converter: CONVERSOR };
  await conexao.run(`COPY t TO ${sqlStr(saida)} (FORMAT parquet, COMPRESSION zstd, ROW_GROUP_SIZE 100000, KV_METADATA {${sqlStr(PARQUET_DBF_HEADER_KEY)}: ${sqlStr(JSON.stringify(headerToJson(header)))}, ${sqlStr(PARQUET_SOURCE_KEY)}: ${sqlStr(JSON.stringify(fonte))}})`);
  conexao.closeSync?.();
  instancia.closeSync?.();
  await rm(temporario, { force: true });
  await rm(`${temporario}.wal`, { force: true });
  const tamanho = (await stat(saida)).size;
  return { ...fonte, parquetBytes: tamanho, parquetSha256: createHash('sha256').update(await readFile(saida)).digest('hex') };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const entrada = process.argv[2];
  if (!entrada) {
    console.error('uso: node scripts/dbc-para-parquet.mjs <entrada.dbc> [saida.parquet]');
    process.exit(1);
  }
  const saida = process.argv[3] ?? entrada.replace(/\.(dbc|dbf)$/i, '.parquet');
  const inicio = Date.now();
  const r = await converter(entrada, saida);
  const kb = (n) => `${(n / 1024).toFixed(0)} KB`;
  console.log(`${r.name} → ${path.basename(saida)}: ${r.recordCount} registros, ${kb(r.bytes)} → ${kb(r.parquetBytes)} (${((r.parquetBytes / r.bytes) * 100).toFixed(0)}%), ${((Date.now() - inicio) / 1000).toFixed(1)} s`);
}
