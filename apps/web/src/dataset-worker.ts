/**
 * Owns the opened dataset so the main thread never holds records.
 *
 * Every consumer that used to read a resident record array — tabulation,
 * numeric profiling, the filter value list, selected-record export — asks this
 * Worker instead, and each request is answered by streaming the retained
 * sources in bounded batches. There is no separate path for large files: the
 * same code serves a 300 KiB SIH file and the 63 MiB national Dengue file.
 *
 * The measured reason this works: decoding records into JavaScript objects is
 * about 91% of the cost of opening a DBC, and a tabulation reads a handful of
 * the hundred-odd declared fields. Every request therefore projects to the
 * fields it actually needs.
 */

import {
  readDbcMetadata,
  readDbfHeader,
  type DbfField,
  type DbfHeader,
  type DbfRecord,
} from '@precisa-saude/datasus-dbc';
import {
  streamDbcRecords,
  streamDbfRecords,
  type DbfRecordBatch,
} from '../../../packages/acquisition/src/dbf-record-stream.ts';
import {
  asyncBufferFromBytes,
  openParquetDataset,
  streamParquetRecords,
  type ParquetDataset,
} from '../../../packages/acquisition/src/parquet-source.ts';
import type { AsyncBuffer } from 'hyparquet';
import { verifyDbcCrc, type DbcCrcReport } from '../../../packages/acquisition/src/dbc-crc.ts';
import {
  createTabulationAccumulator,
  matchesFilters,
  type ConversionRegistry,
} from '../../../packages/core/src/execute.ts';
import { fieldsUsedByPlan } from '../../../packages/core/src/plan-fields.ts';
import { tabwinReadPosition } from '../../../packages/core/src/read-order.ts';
import {
  createColumnarProjectionBuilder,
  createColumnarProjectionCache,
  executeColumnarProjection,
} from '../../../packages/core/src/columnar-cache.ts';
import {
  createFlowAccumulator,
  type FlowBuildResult,
} from '../../../packages/analysis/src/spatial-flows.ts';
import {
  createAuditScanAccumulator,
  type AuditScanResult,
} from '../../../packages/analysis/src/anomaly-orchestrator.ts';
import {
  applyTransformPipeline,
  type TransformStep,
  type TransformStepResult,
} from '../../../packages/analysis/src/transform-pipeline.ts';
import { createTabulationResultCache } from '../../../packages/core/src/tabulation-cache.ts';
import type {
  CrossFieldRuleSpec,
  DataRecord,
  FilterSpec,
  QueryPlan,
  TabulationResult,
} from '../../../packages/core/src/model.ts';
import {
  createDistinctValueCollector,
  createFieldCombinationProfiler,
  createNumericFieldProfiler,
  type FieldCombinationProfile,
  type NumericFieldProfile,
} from '../../../packages/analysis/src/data-quality.ts';
import { createSelectedRecordCollector } from '../../../packages/export/src/selected-records.ts';
import { writeDbf } from '../../../packages/export/src/dbf-writer.ts';
import {
  createMicrodatasusCsvEncoder,
  fieldsUsedByMicrodatasusExport,
  type MicrodatasusFieldSpec,
  type MicrodatasusProvenanceColumn,
  type MicrodatasusSourceContext,
} from '../../../packages/export/src/microdatasus.ts';

/** A source already parsed on the main thread, such as a CSV import. */
interface RecordSource {
  kind: 'records';
  name: string;
  records: DbfRecord[];
}

interface BinarySource {
  kind: 'binary';
  name: string;
  bytes: ArrayBuffer;
  isDbc: boolean;
}

/**
 * O formato leve do TabSis (Parquet convertido de um DBC). Fica guardado como
 * bytes, e cada coluna só é decodificada quando algum pedido a usa — é o que
 * torna a primeira tabela de um arquivo grande rápida.
 */
interface ParquetSource {
  kind: 'parquet';
  name: string;
  bytes: ArrayBuffer;
}

type DatasetSource = RecordSource | BinarySource | ParquetSource;

interface OpenRequest {
  type: 'open';
  requestId: number;
  sources: DatasetSource[];
  /** Declared fields for a record source, which carries no DBF header. */
  fields?: DbfField[];
}

interface TabulateRequest {
  type: 'tabulate';
  requestId: number;
  plan: QueryPlan;
  conversions?: ConversionRegistry;
  /**
   * Só estes arquivos (pelo nome), como a lista "Arquivos" do painel do
   * TabWin. Ausente = todos os abertos.
   */
  sourceNames?: string[];
}

interface NumericProfileRequest {
  type: 'profile-numeric';
  requestId: number;
  field: string;
}

interface DistinctRequest {
  type: 'distinct';
  requestId: number;
  field: string;
  limit?: number;
}

/**
 * Registros crus, para a superfície de consulta.
 *
 * O worker até aqui só devolvia AGREGADOS — tabulação, distintos, fluxos — ou
 * bytes de exportação. O DuckDB precisa das linhas para ingerir, e um teto
 * explícito existe porque materializar milhões de objetos na aba é a maneira
 * conhecida de derrubá-la. O corte é declarado na resposta, nunca silencioso.
 */
interface RecordsRequest {
  type: 'records';
  requestId: number;
  fields: string[];
  maxRecords: number;
  /** Só os registros com `campo = valor`, como o valor sai na tabela sem CNV (branco = ''). */
  where?: { field: string; value: string };
  /** Só os que passam por estas Seleções (a amostra de uma etapa da receita). */
  filters?: FilterSpec[];
  conversions?: ConversionRegistry;
}

interface CombinationProfileRequest {
  type: 'profile-combinations';
  requestId: number;
  fields: string[];
  limit?: number;
}

/**
 * Origin-destination aggregation runs here for the same reason tabulation
 * does: the main thread never holds records, and only three fields are read.
 */
interface FlowRequest {
  type: 'flows';
  requestId: number;
  originField: string;
  destinationField: string;
  weightField?: string;
  knownGeocodes?: string[];
  unknownPolicy?: 'exclude' | 'include';
}

interface SelectedDbfRequest {
  type: 'selected-dbf';
  requestId: number;
  plan: QueryPlan;
  conversions?: ConversionRegistry;
  /** Os mesmos arquivos que a tabela usou (lista "Arquivos" do painel). */
  sourceNames?: string[];
}

interface MicrodatasusCsvRequest {
  type: 'microdatasus-csv';
  requestId: number;
  plan: QueryPlan;
  conversions?: ConversionRegistry;
  fields: MicrodatasusFieldSpec[];
  provenanceColumns?: MicrodatasusProvenanceColumn[];
  sourceContexts?: MicrodatasusSourceContext[];
  maxBytes?: number;
}

/**
 * Statistical anomaly audit. `group` is a plain filter set, deliberately not
 * a QueryPlan - the group under investigation is independent of whatever is
 * being tabulated as rows or columns. Every other record accepted by the
 * open dataset is the reference.
 */
interface AuditScanRequest {
  type: 'audit-scan';
  requestId: number;
  groupFilters: FilterSpec[];
  groupCrossFieldRules?: CrossFieldRuleSpec[];
  conversions?: ConversionRegistry;
  numericFields: string[];
  categoricalFields: string[];
  geographyFields?: string[];
}

/** Adds a schema-compatible file to the open dataset without reopening it. */
interface AppendRequest {
  type: 'append';
  requestId: number;
  source: DatasetSource;
}

/**
 * Materializes every currently retained source into memory, runs the
 * transform pipeline over it, and - on success - replaces the active dataset
 * with the result, exactly like `open`/`append` do. There is no in-place
 * variant: a binary (DBC/DBF) source is normally re-decoded from bytes on
 * every request rather than held resident, but a pipeline step can drop or
 * rewrite values in ways nothing downstream can undo, so its output has to
 * become the new resident source of truth, not a view over the old one.
 */
interface TransformApplyRequest {
  type: 'transform-apply';
  requestId: number;
  steps: TransformStep[];
  conversions?: ConversionRegistry;
}

interface CrcRequest {
  type: 'crc';
  requestId: number;
}

/**
 * Preenchimento de cada campo, arquivo por arquivo (caderno de qualidade do
 * dado): registros, em branco e com código de "ignorado", só dos que passam
 * pelas Seleções. Uma passada pelo arquivo, para todos os campos de uma vez.
 */
interface CompletudeRequest {
  type: 'completude';
  requestId: number;
  filters?: FilterSpec[];
  conversions?: ConversionRegistry;
}

type DatasetRequest =
  | OpenRequest | AppendRequest | TabulateRequest | CrcRequest
  | NumericProfileRequest | CombinationProfileRequest | DistinctRequest | SelectedDbfRequest
  | RecordsRequest | CompletudeRequest
  | FlowRequest | MicrodatasusCsvRequest | AuditScanRequest | TransformApplyRequest;

const workerScope: Worker = self as unknown as Worker;
const BATCH_RECORDS = 5_000;
const PROGRESS_INTERVAL_RECORDS = 20_000;

let sources: DatasetSource[] = [];
let header: DbfHeader | null = null;
/**
 * L3 cache: memoizes a finished tabulation by its exact plan and conversions.
 * Cleared on every 'open'/'append' — a cached result answers for the plan
 * *and* the data it ran over, so once the data changes, nothing in it is
 * still valid, not just the entries that look related.
 */
const resultCache = createTabulationResultCache();

/**
 * L2: guarda as colunas já decodificadas, para uma tabulação nova sobre os
 * MESMOS dados não reler o arquivo.
 *
 * Por que importa: medido neste projeto, transformar registro em objeto
 * JavaScript é ~92% do tempo de abrir um DBC. O L3 acima só ajuda quando o
 * plano é idêntico; trocar a variável de linha ou mexer num filtro caía
 * direto no arquivo de novo. É essa releitura que fazia cada clique custar o
 * preço de abrir o arquivo inteiro.
 *
 * A semântica não muda: o registro é reconstruído e executado pelo mesmo
 * kernel de referência, então CNV, lookups, regras cruzadas e totais
 * continuam com uma implementação só.
 */
/**
 * Teto de memória do cache colunar.
 *
 * Quanto a aba pode gastar é decisão de quem chama, porque só aqui se sabe que
 * ela também segura os dados sendo tabulados. Sem teto, guardar as colunas de
 * um arquivo grande trocaria velocidade por aba travada.
 */
const COLUMNAR_BUDGET_BYTES = 192 * 1024 * 1024;

/**
 * Quatro projeções E um teto de bytes somados.
 *
 * Sem o segundo, quatro projeções de 192 MiB conviviam em 768 MiB: cada uma
 * passava na conferência individual e a soma não era olhada por ninguém.
 */
const columnarCache = createColumnarProjectionCache(4, COLUMNAR_BUDGET_BYTES);

/**
 * Identidade do conjunto em memória.
 *
 * Muda a cada 'open', 'append' e transformação. Uma projeção guardada só vale
 * para os dados que a produziram; reaproveitá-la depois de os dados mudarem
 * devolveria o resultado do arquivo anterior — silenciosamente.
 */
let datasetGeneration = 0;
const datasetSourceId = (): string => `dataset-${datasetGeneration}`;

function invalidateDataset(): void {
  datasetGeneration += 1;
  resultCache.clear();
  columnarCache.clear();
}

function post(message: unknown, transfer: Transferable[] = []): void {
  workerScope.postMessage(message, transfer);
}

function reportProgress(requestId: number, recordsRead: number, recordCount: number): void {
  post({ type: 'progress', requestId, recordsRead, recordCount });
}

interface ParquetState {
  file: AsyncBuffer;
  dataset: ParquetDataset;
  /** Colunas já decodificadas, uma lista de valores por campo, em ordem de registro. */
  columns: Map<string, DbfRecord[string][]>;
}
const parquetStates = new WeakMap<ParquetSource, ParquetState>();

function parquetState(source: ParquetSource): ParquetState {
  const state = parquetStates.get(source);
  if (!state) throw new Error(`${source.name}: Parquet não preparado`);
  return state;
}

/** Campos que um pedido vai ler; `undefined` quer dizer todos. */
function fieldsForRequest(request: DatasetRequest): readonly string[] | undefined {
  switch (request.type) {
    case 'tabulate': return fieldsUsedByPlan(request.plan);
    case 'profile-numeric':
    case 'distinct': return [request.field];
    case 'profile-combinations': return request.fields;
    case 'records': {
      const extras = [request.where?.field, ...(request.filters ?? []).flatMap((filtro) => [filtro.field, ...(filtro.recordSpan ?? []).map((parte) => parte.field)])]
        .filter((campo): campo is string => Boolean(campo) && !request.fields.includes(campo!));
      return extras.length ? [...request.fields, ...new Set(extras)] : request.fields;
    }
    case 'flows': return [request.originField, request.destinationField, ...(request.weightField ? [request.weightField] : [])];
    case 'open':
    case 'append':
    case 'crc': return [];
    default: return undefined;
  }
}

/**
 * Antes de um pedido síncrono, abre os Parquet novos e decodifica as colunas
 * que o pedido vai precisar. O resto do worker continua igual: para ele, um
 * Parquet é só mais uma fonte que entrega lotes de registros.
 */
async function prepareParquet(request: DatasetRequest): Promise<void> {
  const candidates: DatasetSource[] = request.type === 'open'
    ? request.sources
    : request.type === 'append' ? [...sources, request.source] : sources;
  const wanted = fieldsForRequest(request);
  for (const source of candidates) {
    if (source.kind !== 'parquet') continue;
    let state = parquetStates.get(source);
    if (!state) {
      const file = asyncBufferFromBytes(new Uint8Array(source.bytes));
      state = { file, dataset: await openParquetDataset(file), columns: new Map() };
      parquetStates.set(source, state);
    }
    const declared = state.dataset.header.fields.map((field) => field.name);
    const missing = (wanted ?? declared).filter((name) => declared.includes(name) && !state!.columns.has(name));
    if (!missing.length) continue;
    const arrays = new Map(missing.map((name) => [name, [] as DbfRecord[string][]]));
    await streamParquetRecords(state.file, state.dataset, ({ records }) => {
      for (const record of records) for (const [name, values] of arrays) values.push(record[name] ?? null);
    }, { fields: missing, batchSize: 100_000 });
    for (const [name, values] of arrays) state.columns.set(name, values);
  }
}

function streamParquetSource(
  source: ParquetSource,
  fields: readonly string[] | undefined,
  forward: (batch: DbfRecordBatch) => void,
): number {
  const state = parquetState(source);
  const names = (fields ?? state.dataset.header.fields.map((field) => field.name)).filter((name) => state.columns.has(name));
  const total = state.dataset.provenance.recordCount;
  for (let start = 0; start < total; start += BATCH_RECORDS) {
    const end = Math.min(total, start + BATCH_RECORDS);
    const records: DbfRecord[] = [];
    for (let index = start; index < end; index++) {
      const record: DbfRecord = {};
      for (const name of names) record[name] = state.columns.get(name)![index] ?? null;
      records.push(record);
    }
    forward({ records, firstRecordIndex: start, recordsRead: end, recordCount: total });
  }
  return total;
}

function parquetHeader(source: ParquetSource): DbfHeader {
  const { dataset } = parquetState(source);
  return { ...dataset.header, recordCount: dataset.provenance.recordCount };
}

/**
 * Streams every retained source in order through one consumer.
 *
 * Multiple files are not concatenated anywhere: they are streamed one after
 * another into the same accumulator, which is both cheaper and closer to what
 * combining sources actually means.
 */
function streamAll(
  requestId: number,
  fields: readonly string[] | undefined,
  consume: (batch: DbfRecordBatch, sourceIndex: number) => void,
  only?: ReadonlySet<string>,
): number {
  const declared = header?.recordCount ?? 0;
  let readSoFar = 0;
  let reported = 0;

  for (const [sourceIndex, source] of sources.entries()) {
    if (only && !only.has(source.name)) continue;
    const forward = (batch: DbfRecordBatch): void => {
      consume(batch, sourceIndex);
      const total = readSoFar + batch.recordsRead;
      if (total - reported >= PROGRESS_INTERVAL_RECORDS) {
        reported = total;
        reportProgress(requestId, total, declared);
      }
    };

    if (source.kind === 'records') {
      for (let offset = 0; offset < source.records.length; offset += BATCH_RECORDS) {
        const records = source.records.slice(offset, offset + BATCH_RECORDS);
        forward({
          records,
          firstRecordIndex: offset,
          recordsRead: offset + records.length,
          recordCount: source.records.length,
        });
      }
      readSoFar += source.records.length;
      continue;
    }

    // Num conjunto de anos com campos acrescentados, cada arquivo só lê os
    // campos que tem; os outros ficam ausentes (em branco) nos registros dele.
    const proprios = fieldsPresentIn(source, fields);
    if (source.kind === 'parquet') {
      readSoFar += streamParquetSource(source, proprios, forward);
      continue;
    }

    const bytes = new Uint8Array(source.bytes);
    const summary = source.isDbc
      ? streamDbcRecords(bytes, forward, { batchSize: BATCH_RECORDS, ...(proprios ? { fields: proprios } : {}) })
      : streamDbfRecords(bytes, forward, { batchSize: BATCH_RECORDS, ...(proprios ? { fields: proprios } : {}) });
    readSoFar += summary.recordsRead;
  }

  reportProgress(requestId, readSoFar, declared || readSoFar);
  return readSoFar;
}

/**
 * A ordem em que o TabWin leria estes arquivos, um depois do outro: só muda a
 * ordem das linhas do Discriminar (num DBC o TabWin não lê na ordem do
 * arquivo; RE-004, `read-order.ts`).
 */
function readPositionFor(only?: ReadonlySet<string>): (index: number) => number {
  return tabwinReadPosition(sources.filter((source) => !only || only.has(source.name)).map((source) => {
    if (source.kind === 'records') return { recordCount: source.records.length, dbc: false };
    if (source.kind === 'parquet') return { recordCount: parquetHeader(source).recordCount, dbc: false };
    const current = binaryHeader(source);
    return { recordCount: current.recordCount, recordLength: current.recordLength, dbc: source.isDbc };
  }));
}

function headerForSources(request: OpenRequest): DbfHeader {
  const [first] = request.sources;
  if (!first) throw new Error('Nenhuma fonte foi enviada ao trabalhador local');
  if (first.kind === 'records') {
    const fields = request.fields ?? [];
    if (!fields.length) throw new Error('Uma fonte de registros exige a lista de campos');
    const base: DbfHeader = {
      version: 0x03,
      dateOfLastUpdate: new Date(),
      recordCount: 0,
      headerLength: 32 + fields.length * 32 + 1,
      recordLength: 1 + fields.reduce((sum, field) => sum + field.length, 0),
      fields,
    };
    let recordCount = 0;
    for (const source of request.sources) {
      if (source.kind === 'records') {
        recordCount += source.records.length;
        continue;
      }
      const incoming = source.kind === 'parquet' ? parquetHeader(source) : binaryHeader(source);
      if (schemaSignature(base) !== schemaSignature(incoming)) {
        throw new Error(`${source.name}: esquema incompatível com a fonte de registros`);
      }
      recordCount += incoming.recordCount;
    }
    return { ...base, recordCount };
  }

  let recordCount = 0;
  let first_header: DbfHeader | null = null;
  camposAjustados = [];
  for (const source of request.sources) {
    if (source.kind === 'records') throw new Error('Fontes de tipos diferentes não podem ser combinadas');
    const current = headerOf(source);
    first_header = first_header ? mergedSchema(first_header, current, source.name) : current;
    recordCount += current.recordCount;
  }
  return { ...first_header!, recordCount };
}

function binaryHeader(source: BinarySource): DbfHeader {
  const bytes = new Uint8Array(source.bytes);
  return source.isDbc
    ? readDbfHeader(bytes.subarray(0, readDbcMetadata(bytes).headerSize))
    : readDbfHeader(bytes);
}

function schemaSignature(value: DbfHeader): string {
  return value.fields.map((field) => `${field.name}:${field.type}:${field.length}:${field.decimalCount}`).join('|');
}

/**
 * Campos que mudaram de tipo ou tamanho entre os arquivos juntados, para a
 * tela avisar ("NU_LOTE_V (N1 × C7)"). Refeito a cada abertura.
 */
let camposAjustados: string[] = [];

/**
 * Junta o esquema de mais um arquivo ao do conjunto. O DATASUS acrescenta
 * campos com os anos (LEIVBR25 tem 11 a mais que LEIVBR24): o campo novo entra
 * no conjunto e fica em branco nos arquivos que não o têm.
 *
 * Um campo que existe nos dois com tipo, tamanho ou decimais diferentes entra
 * como texto, do tamanho do maior, e vai para `camposAjustados`: cada arquivo
 * continua lido pelo próprio cabeçalho, e a tela diz quais campos mudaram. Antes
 * o ano inteiro era recusado — no LTANBR25 o DATASUS trocou o tipo de quatro
 * campos administrativos (lotes e data de transferência), e 2025 ficava fora
 * de qualquer série.
 */
function mergedSchema(base: DbfHeader, incoming: DbfHeader, name: string): DbfHeader {
  if (schemaSignature(base) === schemaSignature(incoming)) return base;
  const porNome = new Map(incoming.fields.map((field) => [field.name, field]));
  const nomesDaBase = new Set(base.fields.map((field) => field.name));
  const fieldsDaBase = base.fields.map((existente) => {
    const novo = porNome.get(existente.name);
    if (!novo || (existente.type === novo.type && existente.length === novo.length && existente.decimalCount === novo.decimalCount)) return existente;
    const aviso = `${existente.name} (${existente.type}${existente.length} × ${novo.type}${novo.length}, em ${name})`;
    if (!camposAjustados.some((item) => item.startsWith(`${existente.name} `))) camposAjustados.push(aviso);
    return { ...existente, type: 'C' as const, length: Math.max(existente.length, novo.length, existente.type === 'D' || novo.type === 'D' ? 10 : 0), decimalCount: 0 };
  });
  const novos = incoming.fields.filter((field) => !nomesDaBase.has(field.name));
  const fields = [...fieldsDaBase, ...novos];
  return {
    ...base,
    fields,
    headerLength: 32 + fields.length * 32 + 1,
    recordLength: 1 + fields.reduce((sum, field) => sum + field.length, 0),
  };
}

/** Cabeçalho de cada arquivo aberto, para pedir a ele só os campos que ele tem. */
const sourceHeaders = new WeakMap<DatasetSource, DbfHeader>();
function headerOf(source: BinarySource | ParquetSource): DbfHeader {
  let cabecalho = sourceHeaders.get(source);
  if (!cabecalho) {
    cabecalho = source.kind === 'parquet' ? parquetHeader(source) : binaryHeader(source);
    sourceHeaders.set(source, cabecalho);
  }
  return cabecalho;
}

function fieldsPresentIn(source: BinarySource | ParquetSource, fields: readonly string[] | undefined): readonly string[] | undefined {
  if (!fields) return fields;
  const nomes = new Set(headerOf(source).fields.map((field) => field.name));
  return fields.every((name) => nomes.has(name)) ? fields : fields.filter((name) => nomes.has(name));
}

/**
 * A DbfField for a pipeline-created field, inferred from its actual values.
 * Numeric when every present value parses as a number (so it is offered as a
 * measure and profiled as numeric); character otherwise, wide enough for the
 * longest value seen, so a text field never gets mislabeled numeric.
 */
function synthesizeFieldShape(name: string, records: readonly DataRecord[]): DbfField {
  let allNumeric = true;
  let sawValue = false;
  let maxLength = 1;
  for (const record of records) {
    const raw = record[name];
    if (raw === null || raw === undefined) continue;
    sawValue = true;
    const text = raw instanceof Date ? raw.toISOString().slice(0, 10) : String(raw);
    maxLength = Math.max(maxLength, text.length);
    if (allNumeric && typeof raw !== 'number') {
      const value = Number(String(raw).replace(',', '.'));
      if (!Number.isFinite(value)) allNumeric = false;
    }
  }
  if (sawValue && allNumeric) return { name, type: 'N', length: 20, decimalCount: 6 };
  // Character width is bounded so a stray very long value cannot blow the
  // record size out; 254 is the DBF character-field maximum.
  return { name, type: 'C', length: Math.min(254, Math.max(1, maxLength)), decimalCount: 0 };
}

function handle(request: DatasetRequest): void {
  switch (request.type) {
    case 'open': {
      // Computed against the *new* sources before anything module-level
      // changes, so a schema/format error here leaves the previous dataset —
      // and its still-valid cache — untouched.
      const nextHeader = headerForSources(request);
      sources = request.sources;
      header = nextHeader;
      invalidateDataset();
      post({ type: 'opened', requestId: request.requestId, header, recordCount: header.recordCount, ajustes: camposAjustados });
      return;
    }
    case 'append': {
      if (!header) throw new Error('Nenhum conjunto de dados aberto para combinar');
      const source = request.source;
      if (source.kind === 'records') throw new Error('Só arquivos DBC/DBF/Parquet podem ser combinados');
      const incoming = headerOf(source);
      const juntado = mergedSchema(header, incoming, source.name);
      sources = [...sources, source];
      header = { ...juntado, recordCount: header.recordCount + incoming.recordCount };
      invalidateDataset();
      post({ type: 'opened', requestId: request.requestId, header, recordCount: header.recordCount, ajustes: camposAjustados });
      return;
    }
    case 'tabulate': {
      const conversions = request.conversions ?? {};
      const subset = request.sourceNames && request.sourceNames.length < sources.length
        ? new Set(request.sourceNames) : undefined;
      if (subset) {
        // Um recorte dos arquivos é outro conjunto de dados: os caches do
        // conjunto inteiro não valem para ele, e ele não entra neles.
        if (![...subset].some((name) => sources.some((source) => source.name === name))) {
          throw new Error('Nenhum dos arquivos escolhidos está aberto');
        }
        const accumulator = createTabulationAccumulator(request.plan, conversions, { readPosition: readPositionFor(subset) });
        streamAll(request.requestId, fieldsUsedByPlan(request.plan), (batch) => accumulator.push(batch.records), subset);
        post({ type: 'tabulation', requestId: request.requestId, result: accumulator.finish(), cached: false });
        return;
      }
      const cached = resultCache.get({ plan: request.plan, conversions });
      if (cached) {
        post({ type: 'tabulation', requestId: request.requestId, result: cached, cached: true });
        return;
      }
      const planFields = fieldsUsedByPlan(request.plan);
      const sourceId = datasetSourceId();

      // Colunas já decodificadas para estes campos (ou para um superconjunto
      // delas): tabula sem tocar no arquivo.
      const reused = columnarCache.get(sourceId, planFields);
      if (reused) {
        const result: TabulationResult = executeColumnarProjection(reused, request.plan, conversions, { readPosition: readPositionFor() });
        resultCache.set({ plan: request.plan, conversions }, result);
        post({ type: 'tabulation', requestId: request.requestId, result, cached: false });
        return;
      }

      // Primeira passagem sobre estes campos: tabula e monta a projeção na
      // MESMA leitura. Ler duas vezes para poder guardar seria pagar hoje o
      // que se quer economizar amanhã.
      const accumulator = createTabulationAccumulator(request.plan, conversions, { readPosition: readPositionFor() });
      const builder = createColumnarProjectionBuilder(planFields);
      streamAll(request.requestId, planFields, (batch) => {
        accumulator.push(batch.records);
        builder.push(batch.records);
      });
      const result: TabulationResult = accumulator.finish();

      const projection = builder.finish();
      // Só guarda o que cabe no orçamento. Guardar algo grande demais e
      // derrubar a aba seria pior do que reler o arquivo.
      if (projection.estimatedBytes <= COLUMNAR_BUDGET_BYTES) {
        columnarCache.set(sourceId, projection);
      }

      resultCache.set({ plan: request.plan, conversions }, result);
      post({ type: 'tabulation', requestId: request.requestId, result, cached: false });
      return;
    }
    case 'crc': {
      // "Testar CRC" do TabWin: só DBC tem CRC gravado; DBF, CSV e Parquet
      // aparecem como não aplicável.
      const reports: Array<{ name: string; report: DbcCrcReport | null }> = sources.map((source) => ({
        name: source.name,
        report: source.kind === 'binary' && source.isDbc ? verifyDbcCrc(new Uint8Array(source.bytes)) : null,
      }));
      post({ type: 'crc-ready', requestId: request.requestId, reports });
      return;
    }
    case 'profile-numeric': {
      const profiler = createNumericFieldProfiler(request.field);
      streamAll(request.requestId, [request.field], (batch) => profiler.push(batch.records));
      const profile: NumericFieldProfile = profiler.finish();
      post({ type: 'numeric-profile', requestId: request.requestId, profile });
      return;
    }
    case 'profile-combinations': {
      const profiler = createFieldCombinationProfiler(request.fields, { limit: request.limit ?? 50 });
      streamAll(request.requestId, request.fields, (batch) => profiler.push(batch.records));
      const profile: FieldCombinationProfile = profiler.finish();
      post({ type: 'combination-profile', requestId: request.requestId, profile });
      return;
    }
    case 'records': {
      if (!header) throw new Error('Nenhum conjunto de dados aberto');
      if (!request.fields.length) throw new Error('Escolha ao menos um campo para consultar');
      if (!Number.isSafeInteger(request.maxRecords) || request.maxRecords < 1) {
        throw new Error('Limite de registros inválido');
      }
      const coletados: DataRecord[] = [];
      let vistos = 0;
      let cortado = false;
      streamAll(request.requestId, request.fields, (batch) => {
        vistos += batch.records.length;
        if (cortado) return;
        for (const record of batch.records) {
          if (request.where && String(record[request.where.field] ?? '') !== request.where.value) continue;
          if (request.filters && !matchesFilters(record, request.filters, undefined, request.conversions ?? {})) continue;
          if (coletados.length >= request.maxRecords) { cortado = true; return; }
          coletados.push(record);
        }
      });
      post({
        type: 'records-ready',
        requestId: request.requestId,
        records: coletados,
        seen: vistos,
        truncated: cortado,
      });
      return;
    }
    case 'completude': {
      if (!header) throw new Error('Nenhum conjunto de dados aberto');
      const campos = header.fields.map((field) => field.name);
      // "Ignorado" no DATASUS: 9, 99, 999, 9999 ou I (sexo). Contado à parte do branco.
      const ignorado = /^(?:9{1,4}|I)$/;
      const porFonte = sources.map((source) => ({
        fonte: source.name, registros: 0,
        brancos: Object.fromEntries(campos.map((campo) => [campo, 0])) as Record<string, number>,
        ignorados: Object.fromEntries(campos.map((campo) => [campo, 0])) as Record<string, number>,
      }));
      streamAll(request.requestId, undefined, (batch, indice) => {
        const conta = porFonte[indice]!;
        for (const record of batch.records) {
          if (request.filters?.length && !matchesFilters(record, request.filters, undefined, request.conversions ?? {})) continue;
          conta.registros += 1;
          for (const campo of campos) {
            const valor = record[campo];
            const texto = valor === null || valor === undefined ? '' : valor instanceof Date ? 'data' : String(valor).trim();
            if (texto === '') conta.brancos[campo]! += 1;
            else if (ignorado.test(texto)) conta.ignorados[campo]! += 1;
          }
        }
      });
      post({ type: 'completude', requestId: request.requestId, campos, porFonte });
      return;
    }
    case 'distinct': {
      const collector = createDistinctValueCollector(request.field, request.limit ?? 500);
      streamAll(request.requestId, [request.field], (batch) => collector.push(batch.records));
      const collected = collector.finish();
      post({ type: 'distinct-values', requestId: request.requestId, ...collected });
      return;
    }
    case 'flows': {
      const fields = [request.originField, request.destinationField];
      if (request.weightField) fields.push(request.weightField);
      const accumulator = createFlowAccumulator({
        originField: request.originField,
        destinationField: request.destinationField,
        ...(request.weightField ? { weightField: request.weightField } : {}),
        ...(request.knownGeocodes ? { knownGeocodes: new Set(request.knownGeocodes) } : {}),
        ...(request.unknownPolicy ? { unknownPolicy: request.unknownPolicy } : {}),
      });
      streamAll(request.requestId, fields, (batch) => accumulator.push(batch.records));
      const result: FlowBuildResult = accumulator.finish();
      post({ type: 'flows-ready', requestId: request.requestId, result });
      return;
    }
    case 'selected-dbf': {
      if (!header) throw new Error('Nenhum conjunto de dados aberto');
      const collector = createSelectedRecordCollector(request.plan, request.conversions ?? {});
      // No projection here: the exported DBF must carry every declared field.
      const only = request.sourceNames?.length ? new Set(request.sourceNames) : undefined;
      streamAll(request.requestId, undefined, (batch) => collector.push(batch.records), only);
      const bytes = writeDbf(collector.finish(), header.fields, header.dateOfLastUpdate ? { dateOfLastUpdate: header.dateOfLastUpdate } : {});
      const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
      post({ type: 'selected-dbf-ready', requestId: request.requestId, bytes: buffer }, [buffer]);
      return;
    }
    case 'microdatasus-csv': {
      if (!header) throw new Error('Nenhum conjunto de dados aberto');
      const maxBytes = request.maxBytes ?? 512 * 1024 * 1024;
      if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 2 * 1024 * 1024 * 1024) {
        throw new Error('Limite Microdatasus inválido');
      }
      if (request.sourceContexts && request.sourceContexts.length !== sources.length) {
        throw new Error('Proveniência Microdatasus não corresponde às fontes abertas');
      }
      const conversions = request.conversions ?? {};
      const exporter = createMicrodatasusCsvEncoder(request.plan, request.fields, conversions, {
        provenanceColumns: request.provenanceColumns ?? [],
      });
      let emitted = 0;
      const emitChunk = (bytes: Uint8Array): void => {
        if (!bytes.byteLength) return;
        emitted += bytes.byteLength;
        if (emitted > maxBytes) {
          throw new Error(`Microdatasus excedeu ${(maxBytes / 1024 / 1024).toFixed(0)} MiB; restrinja os filtros antes de exportar`);
        }
        const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
        post({ type: 'microdatasus-chunk', requestId: request.requestId, bytes: buffer }, [buffer]);
      };
      emitChunk(exporter.header());
      const projectedFields = fieldsUsedByMicrodatasusExport(request.plan, request.fields);
      streamAll(request.requestId, projectedFields, (batch, sourceIndex) => {
        emitChunk(exporter.push(batch.records, request.sourceContexts?.[sourceIndex]));
      });
      const stats = exporter.finish();
      post({ type: 'microdatasus-ready', requestId: request.requestId, stats });
      return;
    }
    case 'audit-scan': {
      if (!header) throw new Error('Nenhum conjunto de dados aberto');
      const conversions = request.conversions ?? {};
      const isGroup = (record: DataRecord): boolean =>
        matchesFilters(record, request.groupFilters, request.groupCrossFieldRules, conversions);
      const accumulator = createAuditScanAccumulator(isGroup, {
        numericFields: request.numericFields,
        categoricalFields: request.categoricalFields,
        ...(request.geographyFields ? { geographyFields: request.geographyFields } : {}),
      });
      // Every field a group filter or cross-field condition reads must stay
      // in the projection too, or matchesFilters would see it as always
      // absent and the group would silently become empty.
      const filterFields = request.groupFilters.map((filter) => filter.field);
      const crossFieldFields = (request.groupCrossFieldRules ?? [])
        .flatMap((rule) => rule.conditions.map((condition) => condition.field));
      const projectedFields = [...new Set([
        ...request.numericFields, ...request.categoricalFields, ...filterFields, ...crossFieldFields,
      ])];
      streamAll(request.requestId, projectedFields, (batch) => accumulator.push(batch.records));
      const result: AuditScanResult = accumulator.finish();
      post({ type: 'audit-scan-ready', requestId: request.requestId, result });
      return;
    }
    case 'transform-apply': {
      if (!header) throw new Error('Nenhum conjunto de dados aberto');
      const originalHeader = header;
      const originalFields = originalHeader.fields.map((field) => field.name);

      // No projection: a step the user adds later can reference any field
      // that survived so far, and the final field set is only known once the
      // whole pipeline has run - the same reason "selected-dbf" also reads
      // every declared field instead of guessing which ones matter.
      const collected: DataRecord[] = [];
      streamAll(request.requestId, undefined, (batch) => { for (const record of batch.records) collected.push(record); });

      const outcome = applyTransformPipeline(collected, originalFields, request.steps, request.conversions ?? {});

      const originalFieldByName = new Map(originalHeader.fields.map((field) => [field.name, field]));
      const fields: DbfField[] = outcome.fields.map((field) => {
        if (field.originalName === undefined) {
          // A field the pipeline created (derive-column, a date part, an
          // aggregation) or brought in from a second source has no original to
          // inherit a shape from. Inspect its actual values instead of
          // assuming: a numeric column so it is offered as a measure, a
          // character column wide enough for its longest value otherwise, so a
          // text field a bind-rows source contributed is never mislabeled N.
          return synthesizeFieldShape(field.name, outcome.records);
        }
        const original = originalFieldByName.get(field.originalName);
        // Cannot actually be missing: applyTransformPipeline only ever
        // carries a field's originalName forward from this exact map.
        if (!original) throw new Error(`internal: campo original ${field.originalName} não encontrado`);
        return { ...original, name: field.name };
      });
      const nextHeader: DbfHeader = {
        version: 0x03,
        dateOfLastUpdate: new Date(),
        headerLength: 32 + fields.length * 32 + 1,
        recordLength: 1 + fields.reduce((sum, field) => sum + field.length, 0),
        fields,
        recordCount: outcome.records.length,
      };

      sources = [{ kind: 'records', name: 'Dados transformados', records: outcome.records as DbfRecord[] }];
      header = nextHeader;
      invalidateDataset();
      const steps: TransformStepResult[] = outcome.steps;
      post({ type: 'transform-applied', requestId: request.requestId, header, recordCount: header.recordCount, steps });
      return;
    }
  }
}

// Uma fila: preparar um Parquet é assíncrono, e um pedido não pode começar
// enquanto o anterior ainda decodifica colunas — os dois mexeriam no mesmo
// conjunto. Sem Parquet, a preparação não espera nada e o fluxo é o de antes.
let fila: Promise<void> = Promise.resolve();
workerScope.addEventListener('message', (event: MessageEvent<DatasetRequest>) => {
  const request = event.data;
  fila = fila.then(async () => {
    try {
      await prepareParquet(request);
      handle(request);
    } catch (error) {
      post({
        type: 'error',
        requestId: request.requestId,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });
});
