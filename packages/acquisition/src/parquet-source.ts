/**
 * O formato leve do TabSis: o mesmo DBC, em Parquet.
 *
 * O professor pediu um formato mais leve que o DBC para guardar na Cloudflare.
 * Parquet resolve as duas coisas que pesam no DBC:
 *
 * 1. **Tamanho.** Colunas comprimidas com ZSTD e dicionário ficam em torno de
 *    metade do DBC (RDAC2401: 313 KB → 174 KB; DOINF23: 3,5 MB → 1,7 MB).
 * 2. **Leitura por coluna.** O DBC é um DBF inteiro comprimido: para tabular
 *    SEXO é preciso descomprimir e decodificar os 113 campos de cada registro
 *    — 85% do tempo de abrir um arquivo. No Parquet cada coluna é um bloco
 *    separado; a tabulação lê só as colunas que o plano usa.
 *
 * A regra que não muda: o motor de tabulação continua sendo o mesmo, e recebe
 * os registros **iguais, valor a valor e tipo a tipo**, aos que o leitor de DBC
 * produz. O conversor (`scripts/dbc-para-parquet.mjs`) grava cada campo com o
 * tipo que o leitor de DBF devolve — texto, número, data, lógico, nulo — e o
 * cabeçalho DBF original vai junto, nos metadados do arquivo, para o aplicativo
 * mostrar os mesmos campos e reescrever o DBF idêntico se preciso.
 * `scripts/verify-parquet-parity.mjs` confere isso registro a registro.
 */

import type { DbfField, DbfHeader, DbfRecord } from '@precisa-saude/datasus-dbc';
import { decompress as decompressZstd } from 'fzstd';
import { parquetMetadataAsync, parquetReadObjects, type AsyncBuffer, type FileMetaData } from 'hyparquet';

/** Chave dos metadados com o cabeçalho DBF original. */
export const PARQUET_DBF_HEADER_KEY = 'tabsis.dbf-header';
/** Chave dos metadados com a procedência do arquivo de origem. */
export const PARQUET_SOURCE_KEY = 'tabsis.fonte';

export interface ParquetSourceProvenance {
  /** Nome original do arquivo do DATASUS, ex.: `RDAC2401.dbc`. */
  name: string;
  /** SHA-256 do `.dbc` (ou `.dbf`) de origem, o mesmo que o espelho declara. */
  sha256: string;
  bytes: number;
  /** Registros gravados: os do DBF menos os marcados como apagados. */
  recordCount: number;
  /** Versão do conversor, para que um defeito futuro seja rastreável. */
  converter: string;
}

export interface ParquetDbfHeaderJson {
  version: number;
  dateOfLastUpdate: string;
  headerLength: number;
  recordLength: number;
  recordCount: number;
  fields: DbfField[];
}

export interface ParquetDataset {
  header: DbfHeader;
  provenance: ParquetSourceProvenance;
  metadata: FileMetaData;
}

const COMPRESSORS = {
  ZSTD: (input: Uint8Array, outputLength: number) => decompressZstd(input, new Uint8Array(outputLength)),
};

export function asyncBufferFromBytes(bytes: Uint8Array): AsyncBuffer {
  const buffer = bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
    ? bytes.buffer as ArrayBuffer
    : bytes.slice().buffer as ArrayBuffer;
  return {
    byteLength: buffer.byteLength,
    slice: (start: number, end?: number) => buffer.slice(start, end),
  };
}

export function headerToJson(header: DbfHeader): ParquetDbfHeaderJson {
  return {
    version: header.version,
    dateOfLastUpdate: header.dateOfLastUpdate.toISOString(),
    headerLength: header.headerLength,
    recordLength: header.recordLength,
    recordCount: header.recordCount,
    fields: header.fields.map((field) => ({ ...field })),
  };
}

function headerFromJson(json: ParquetDbfHeaderJson): DbfHeader {
  return {
    version: json.version,
    dateOfLastUpdate: new Date(json.dateOfLastUpdate),
    headerLength: json.headerLength,
    recordLength: json.recordLength,
    recordCount: json.recordCount,
    fields: json.fields.map((field) => ({ ...field })),
  } as DbfHeader;
}

/** Lê só o rodapé do Parquet: cabeçalho DBF, procedência e esquema. */
export async function openParquetDataset(file: AsyncBuffer): Promise<ParquetDataset> {
  const metadata = await parquetMetadataAsync(file);
  const kv = new Map((metadata.key_value_metadata ?? []).map((entry) => [entry.key, entry.value ?? '']));
  const headerText = kv.get(PARQUET_DBF_HEADER_KEY);
  const sourceText = kv.get(PARQUET_SOURCE_KEY);
  if (!headerText || !sourceText) {
    throw new Error('Este Parquet não foi gerado pelo TabSis a partir de um DBC (faltam os metadados de origem).');
  }
  const header = headerFromJson(JSON.parse(headerText) as ParquetDbfHeaderJson);
  const provenance = JSON.parse(sourceText) as ParquetSourceProvenance;
  if (Number(metadata.num_rows) !== provenance.recordCount) {
    throw new Error(`Parquet com ${String(metadata.num_rows)} linhas, mas a origem declara ${provenance.recordCount} registros.`);
  }
  return { header, provenance, metadata };
}

/**
 * Volta um valor do Parquet ao tipo que o leitor de DBF produz.
 *
 * DATE chega como `Date` em UTC; INT32 de campo `I` pode chegar como número;
 * BIGINT não é usado pelo conversor. O que importa é a igualdade com o DBF.
 */
function normalizeValue(value: unknown, field: DbfField): DbfRecord[string] {
  if (value === null || value === undefined) return null;
  switch (field.type) {
    case 'C': return typeof value === 'string' ? value : String(value);
    case 'N':
    case 'F':
    case 'I': return typeof value === 'bigint' ? Number(value) : Number(value);
    case 'D': return value instanceof Date ? value : new Date(String(value));
    case 'L': return Boolean(value);
    default: return value as DbfRecord[string];
  }
}

export interface ParquetBatch {
  records: DbfRecord[];
  firstRecordIndex: number;
  recordsRead: number;
  recordCount: number;
}

export interface ParquetStreamOptions {
  /** Só estas colunas; ausente = todas, como no DBF. */
  fields?: readonly string[];
  batchSize?: number;
  shouldCancel?: () => boolean;
}

/**
 * Entrega os registros em lotes, lendo apenas as colunas pedidas.
 *
 * Um campo pedido que o arquivo não tem fica ausente do registro, como na
 * projeção do leitor de DBF.
 */
export async function streamParquetRecords(
  file: AsyncBuffer,
  dataset: ParquetDataset,
  onBatch: (batch: ParquetBatch) => void,
  options: ParquetStreamOptions = {},
): Promise<number> {
  const available = new Map(dataset.header.fields.map((field) => [field.name, field]));
  const wanted = (options.fields ?? dataset.header.fields.map((field) => field.name))
    .filter((name) => available.has(name));
  const total = dataset.provenance.recordCount;
  const batchSize = Math.max(1, options.batchSize ?? 50_000);
  let emitted = 0;
  for (let start = 0; start < total; start += batchSize) {
    if (options.shouldCancel?.()) break;
    const end = Math.min(total, start + batchSize);
    const rows = wanted.length
      ? await parquetReadObjects({
        file,
        metadata: dataset.metadata,
        columns: [...wanted],
        rowStart: start,
        rowEnd: end,
        compressors: COMPRESSORS,
      })
      : Array.from({ length: end - start }, () => ({}));
    const records: DbfRecord[] = rows.map((row) => {
      const record: DbfRecord = {};
      for (const name of wanted) record[name] = normalizeValue((row as Record<string, unknown>)[name], available.get(name)!);
      return record;
    });
    onBatch({ records, firstRecordIndex: start, recordsRead: end, recordCount: total });
    emitted += records.length;
  }
  return emitted;
}
