import type { CnvDefinition } from '../../formats/src/cnv-model.js';
import { classifyCnv } from '../../formats/src/cnv-match.js';
import type {
  CrossFieldRuleSpec,
  DataRecord,
  DimensionLookupDefinition,
  DimensionSpec,
  FilterSpec,
  MeasureSpec,
  QueryPlan,
  RecordFieldLayout,
  ResultAxisItem,
  TabulationResult,
  TabulationSpec,
} from './model.js';

export type ConversionRegistry = Readonly<Record<string, CnvDefinition | DimensionLookupDefinition>>;

export interface ResolvedDimensionValue {
  key?: string;
  label?: string;
}

export interface ResolvedPlanRecord {
  rowKey: string;
  rowLabel: string;
  columnKey: string;
  columnLabel: string;
}

const UNCLASSIFIED_KEY = '__tabwin_web_unclassified__';
const UNCLASSIFIED_LABEL = 'Não classificados';
/** Prefix of a row key created by "Discriminar" for one unclassified code. */
const UNCLASSIFIED_CODE_PREFIX = '__tabsis_codigo__:';

/**
 * What an unmatched value becomes. `literal` says whether the axis compares
 * codes as text (literal CNV or DBF lookup) — the only case in which TabWin's
 * "Discriminar" lists each code on its own row.
 */
function unclassifiedValue(
  dimension: DimensionSpec,
  code: string,
  literal: boolean,
): ResolvedDimensionValue {
  if (dimension.unclassifiedPolicy === 'discriminate') return { key: UNCLASSIFIED_KEY, label: UNCLASSIFIED_LABEL };
  if (dimension.unclassifiedPolicy === 'discriminate-codes' && literal && code) {
    return { key: `${UNCLASSIFIED_CODE_PREFIX}${code}`, label: code };
  }
  return {};
}

function measureColumnLabel(measure: MeasureSpec, plan: QueryPlan): string {
  // G001's lossless TabWin 4.15 export establishes the count header exactly.
  // G003 established the sum header: the real engine uses the DEF increment's
  // own label ("Valor Total" for VAL_TOT), not a generic word. "Valor" remains
  // only for a sum with no increment label behind it — a case TabWin has no
  // precedent for, since its sums always come from a DEF increment.
  if (measure.kind !== 'count') return measure.label ?? 'Valor';
  return plan.spec.compatibilityProfile === 'tabwin-4.15' ? 'Freqüência' : 'Frequência';
}

function singleColumnLabel(plan: QueryPlan): string {
  return measureColumnLabel(plan.spec.measure, plan);
}

/** G017: several DEF `I` increments laid out as columns in declared order. */
function measureColumnKey(index: number): string {
  return `__measure_${index}__`;
}

function getConversion(registry: ConversionRegistry, id: string): CnvDefinition {
  const definition = registry[id];
  if (!definition) throw new Error(`missing conversion: ${id}`);
  if ('kind' in definition) throw new Error(`resource ${id} is a DBF lookup, not a CNV conversion`);
  // The N layout was unblocked once G012's derived row was explained by a
  // controlled experiment: its subtotal indicator is 4 columns wide, and the
  // row it produces is ordinary subtotal propagation, not an anomaly. Writing
  // an N file back out is still refused (see cnv-serializer.ts) — reading and
  // executing are proven, round-tripping the layout is not.
  return definition;
}

interface LookupIndex {
  byKey: Map<string, { key: string; label: string }>;
  /** Comprimentos das chaves, do maior para o menor. */
  lengths: number[];
}
const lookupIndexes = new WeakMap<DimensionLookupDefinition, LookupIndex>();

/**
 * A linha da tabela DBF para um valor do registro. Primeiro a chave inteira;
 * sem ela, o começo do valor do tamanho da chave, como o TabWin: no SIA,
 * PA_PROC_ID "0301010072" cai no grupo "03" (TB_GRUPO.DBF), no subgrupo "0301"
 * e na forma de organização "030101" (varredura de 2026-10-24).
 */
function lookupEntry(lookup: DimensionLookupDefinition, value: string): { key: string; label: string } | undefined {
  let index = lookupIndexes.get(lookup);
  if (!index) {
    const byKey = new Map<string, { key: string; label: string }>();
    for (const entry of lookup.entries) {
      for (const code of entry.codes ?? [entry.key]) if (!byKey.has(code)) byKey.set(code, entry);
    }
    index = { byKey, lengths: [...new Set([...byKey.keys()].map((code) => code.length))].sort((a, b) => b - a) };
    lookupIndexes.set(lookup, index);
  }
  const exact = index.byKey.get(value);
  if (exact) return exact;
  for (const length of index.lengths) {
    if (length >= value.length) continue;
    const entry = index.byKey.get(value.slice(0, length));
    if (entry) return entry;
  }
  return undefined;
}

function getLookup(registry: ConversionRegistry, id: string): DimensionLookupDefinition {
  const definition = registry[id];
  if (!definition) throw new Error(`missing DBF lookup: ${id}`);
  if (!('kind' in definition) || definition.kind !== 'dbf-lookup') {
    throw new Error(`resource ${id} is a CNV conversion, not a DBF lookup`);
  }
  return definition;
}

/** O valor como estava escrito no registro de largura fixa do DBF. */
function fixedWidthText(value: unknown, layout: RecordFieldLayout): string {
  const width = layout.length;
  if (value === null || value === undefined) return ' '.repeat(width);
  let text: string;
  if (typeof value === 'number') {
    text = layout.decimals > 0 ? value.toFixed(layout.decimals) : String(Math.round(value));
    return text.padStart(width).slice(-width);
  }
  // Campo numérico lido como texto: no DBF ele fica alinhado à direita.
  if (typeof value === 'string' && /^[NF]$/i.test(layout.type)) return value.trim().padStart(width).slice(-width);
  if (value instanceof Date) {
    text = `${value.getUTCFullYear()}${String(value.getUTCMonth() + 1).padStart(2, '0')}${String(value.getUTCDate()).padStart(2, '0')}`;
  } else if (typeof value === 'boolean') {
    text = value ? 'T' : 'F';
  } else {
    text = String(value);
  }
  return text.padEnd(width).slice(0, width);
}

/**
 * Lê o código como o TabWin: `codeLength` caracteres a partir da posição, no
 * registro de largura fixa, atravessando para os campos seguintes (RE-003).
 */
function spannedCode(record: DataRecord, span: readonly RecordFieldLayout[], startPosition: number | undefined, conversion: CnvDefinition): string {
  const raw = span.map((layout) => fixedWidthText(record[layout.field], layout)).join('');
  const start = (startPosition ?? 1) - 1;
  const code = raw.slice(start, start + conversion.codeLength);
  return code;
}

/**
 * Seleção com CNV de faixas numéricas: o TabWin não classifica o valor (como faz
 * na Linha), lê `codeLength` caracteres do registro a partir do índice igual à
 * posição do DEF — contado do zero, um caractere adiante do que a Linha usaria —,
 * atravessando para o campo seguinte. Medido em 2026-10-24 (sondas SONDB/SONDC/
 * SONDD, DIAS_PERM N5 + MORTE com PERM.CNV): posição 1 dá o valor; posição 2
 * lê "  0" + MORTE, e os 6 óbitos com 0 dia caem em "1 dia". Texto em branco não
 * classifica.
 */
function numericRangeSelectionText(record: DataRecord, span: readonly RecordFieldLayout[], startPosition: number | undefined, conversion: CnvDefinition): string | undefined {
  const raw = span.map((layout) => fixedWidthText(record[layout.field], layout)).join('');
  const start = startPosition ?? 1;
  const text = raw.slice(start, start + conversion.codeLength);
  return text.trim() ? text : undefined;
}

function extractSourceValue(
  record: DataRecord,
  field: string,
  startPosition: number | undefined,
  conversion: CnvDefinition | undefined,
  span?: readonly RecordFieldLayout[],
): unknown {
  if (span && conversion && (conversion.mode === 'short' || conversion.mode === 'literal')) {
    return spannedCode(record, span, startPosition, conversion);
  }
  const raw = record[field];
  if (raw === null || raw === undefined) return raw;

  // A numeric-range CNV always classifies the value itself, never a slice of
  // its text — the DEF's start position simply does not apply to this mode.
  //
  // G009 proved this against the real engine. AIH_MA.DEF declares position 2
  // for DIAS_PERM, and we previously honoured it for any position other than
  // 1: String(2).slice(1) is "", which Number() turns into 0, so 3,932 of
  // 4,315 records collapsed into the "0 dias" band. TabWin puts only 212
  // there and reproduces the real length-of-stay distribution, which is
  // exactly what reading the numeric value gives.
  if (conversion?.mode === 'numeric-ranges') return raw;

  if (startPosition === undefined && conversion === undefined) return raw;
  const start = (startPosition ?? 1) - 1;
  const text = String(raw);
  const length = conversion?.codeLength;
  return length === undefined ? text.slice(start) : text.slice(start, start + length);
}

export function resolveDimensionValue(
  record: DataRecord,
  dimension: DimensionSpec,
  conversions: ConversionRegistry,
): ResolvedDimensionValue {
  const lookup = dimension.lookupId ? getLookup(conversions, dimension.lookupId) : undefined;
  const definition = dimension.conversionId
    ? getConversion(conversions, dimension.conversionId)
    : undefined;
  const raw = extractSourceValue(
    record,
    dimension.field,
    dimension.startPosition,
    definition,
    dimension.recordSpan,
  );
  if (lookup) {
    const key = String(raw ?? '').trim();
    const entry = lookupEntry(lookup, key);
    if (!entry) return unclassifiedValue(dimension, key, true);
    return { key: entry.key, label: entry.label };
  }
  if (!definition) {
    if (raw === null || raw === undefined || raw === '') {
      return unclassifiedValue(dimension, '', false);
    }
    const value = String(raw);
    return { key: value, label: value };
  }

  const match = classifyCnv(definition, raw, { textual: Boolean(dimension.recordSpan) || typeof record[dimension.field] !== 'number' });
  if (!match) {
    return unclassifiedValue(dimension, String(raw ?? '').trim(), definition.mode === 'literal');
  }
  return { key: String(match.sequence), label: match.label };
}

function acceptsFilter(
  record: DataRecord,
  filter: FilterSpec,
  conversions: ConversionRegistry,
): boolean {
  const definition = filter.conversionId
    ? getConversion(conversions, filter.conversionId)
    : undefined;
  const raw = definition?.mode === 'numeric-ranges' && filter.recordSpan
    ? numericRangeSelectionText(record, filter.recordSpan, filter.startPosition, definition)
    : extractSourceValue(record, filter.field, filter.startPosition, definition, filter.recordSpan);
  let matches: boolean;
  if (filter.kind === 'numeric-range') {
    const value = typeof raw === 'number' ? raw : Number(String(raw ?? '').replace(',', '.'));
    if (!Number.isFinite(value)) matches = false;
    else {
      const aboveMinimum = filter.minimum === undefined
        || (filter.includeMinimum === false ? value > filter.minimum : value >= filter.minimum);
      const belowMaximum = filter.maximum === undefined
        || (filter.includeMaximum === false ? value < filter.maximum : value <= filter.maximum);
      matches = aboveMinimum && belowMaximum;
    }
  } else if (!definition) {
    matches = filter.acceptedCategories.includes(String(raw ?? ''));
  } else {
    const match = classifyCnv(definition, raw, { textual: Boolean(filter.recordSpan) || typeof record[filter.field] !== 'number' });
    matches = match
      ? filter.acceptedCategories.includes(String(match.sequence))
      : filter.includeUnclassified === true;
  }
  return filter.mode === 'exclude' ? !matches : matches;
}

function axisFromDimension(
  dimension: DimensionSpec,
  conversions: ConversionRegistry,
  observed: Map<string, string>,
  order?: DiscriminateOrder,
): ResultAxisItem[] {
  if (dimension.lookupId) {
    const lookup = getLookup(conversions, dimension.lookupId);
    const items: ResultAxisItem[] = lookup.entries.map((entry) => ({
      key: entry.key,
      label: entry.label,
      source: 'conversion',
    }));
    // "Incluir": a linha "Não classificados" só aparece se houver algum — o
    // TabWin não a mostra vazia (Help do TabWin v2; RE-003, D4 e T4).
    if (dimension.unclassifiedPolicy === 'discriminate' && observed.has(UNCLASSIFIED_KEY)) {
      items.push({ key: UNCLASSIFIED_KEY, label: UNCLASSIFIED_LABEL, source: 'conversion' });
    }
    items.push(...discriminatedCodes(dimension, observed, order));
    return items;
  }
  if (dimension.conversionId) {
    const definition = getConversion(conversions, dimension.conversionId);
    // A category referenced as a subtotal target is a presentation subtotal,
    // not another independent contribution to TabWin's final Total row.
    // G010 proves this against BR_REGIAOUF.CNV: every record is shown once in
    // its UF detail and once in its Region subtotal, while TabWin's Total stays
    // 4,315 rather than double-counting both levels as 8,630.
    const subtotalTargetSequences = new Set(
      definition.categories
        .map((category) => category.subtotalTarget)
        .filter((sequence): sequence is number => sequence !== undefined),
    );
    const items: ResultAxisItem[] = definition.categories.map((category) => ({
      key: String(category.sequence),
      // Sem rótulo, a linha fica em branco, como no TabWin (número que o
      // cabeçalho da CNV conta e nenhuma linha define).
      label: category.label,
      source: 'conversion',
      ...(category.subtotalTarget !== undefined
        ? { subtotalTargetKey: String(category.subtotalTarget) }
        : {}),
      ...(category.excludeFromTotal || subtotalTargetSequences.has(category.sequence)
        ? { excludeFromTotal: true }
        : {}),
    }));
    // "Incluir": a linha "Não classificados" só aparece se houver algum — o
    // TabWin não a mostra vazia (Help do TabWin v2; RE-003, D4 e T4).
    if (dimension.unclassifiedPolicy === 'discriminate' && observed.has(UNCLASSIFIED_KEY)) {
      items.push({ key: UNCLASSIFIED_KEY, label: UNCLASSIFIED_LABEL, source: 'conversion' });
    }
    items.push(...discriminatedCodes(dimension, observed, order));
    return items;
  }
  return [...observed.entries()]
    .sort(([a], [b]) => a.localeCompare(b, 'en', { numeric: true }))
    .map(([key, label]) => ({ key, label, source: 'raw' as const }));
}

/** Posição de leitura do TabWin em que cada código do Discriminar apareceu primeiro. */
interface DiscriminateOrder {
  firstSeen: Map<string, number>;
}

/**
 * "Discriminar": uma linha por código sem correspondência, na ordem em que o
 * TabWin o encontra (05, 02, 04 no oráculo). Num DBC essa não é a ordem do
 * arquivo — ver `read-order.ts` (RE-004).
 */
function discriminatedCodes(dimension: DimensionSpec, observed: Map<string, string>, order?: DiscriminateOrder): ResultAxisItem[] {
  if (dimension.unclassifiedPolicy !== 'discriminate-codes') return [];
  const items = [...observed.entries()]
    .filter(([key]) => key.startsWith(UNCLASSIFIED_CODE_PREFIX))
    .map(([key, label]) => ({ key, label, source: 'raw' as const }));
  if (!order) return items;
  const position = (key: string) => order.firstSeen.get(key) ?? 0;
  return items.sort((a, b) => position(a.key) - position(b.key));
}

function numericFieldValue(
  record: DataRecord,
  field: string,
  warnings: Set<string>,
  context: string,
): number {
  const raw = record[field];
  if (raw === null || raw === undefined || raw === '') return 0;
  const value = typeof raw === 'number' ? raw : Number(String(raw).replace(',', '.'));
  if (!Number.isFinite(value)) {
    warnings.add(`non-numeric value encountered in ${context} field ${field}; treated as zero`);
    return 0;
  }
  return value;
}

function measureValueFor(record: DataRecord, measure: MeasureSpec, warnings: Set<string>): number {
  if (measure.kind === 'count') {
    const weightField = measure.weightField;
    return weightField ? numericFieldValue(record, weightField, warnings, 'grouped-frequency') : 1;
  }
  const field = measure.field;
  if (!field) return 0;
  return numericFieldValue(record, field, warnings, 'sum');
}

/**
 * Resolves the exact record-acceptance boundary shared by tabulation and
 * record-level exports. A record rejected by filters or omitted dimensions
 * returns undefined.
 */
/**
 * True when every condition accepts the record, i.e. the implausible
 * combination the rule describes is present.
 */
export function crossFieldRuleMatches(
  record: DataRecord,
  rule: CrossFieldRuleSpec,
  conversions: ConversionRegistry = {},
): boolean {
  return rule.conditions.every((condition) => acceptsFilter(record, condition, conversions));
}

/**
 * Exclusion is decided here rather than in the executor so that every caller
 * of {@link resolvePlanRecord} — tabulation, selected-record export — applies
 * the same cleaning policy instead of diverging.
 */
export function excludedByCrossFieldRules(
  record: DataRecord,
  plan: QueryPlan,
  conversions: ConversionRegistry = {},
): boolean {
  return (plan.spec.crossFieldRules ?? []).some((rule) =>
    rule.action === 'exclude' && crossFieldRuleMatches(record, rule, conversions));
}

/**
 * Whether a record passes an explicit filter set and no exclude cross-field
 * rule matches it - the same acceptance boundary {@link resolvePlanRecord}
 * starts from, without also requiring the plan's row/column dimensions to
 * resolve. A statistical audit's "group under investigation" is a filter
 * set on its own, independent of what is being tabulated as rows or columns,
 * so it needs this narrower question, not the full plan-record resolution.
 */
export function matchesFilters(
  record: DataRecord,
  filters: readonly FilterSpec[],
  crossFieldRules: readonly CrossFieldRuleSpec[] | undefined,
  conversions: ConversionRegistry = {},
): boolean {
  if ((crossFieldRules ?? []).some((rule) => rule.action === 'exclude' && crossFieldRuleMatches(record, rule, conversions))) {
    return false;
  }
  return filters.every((filter) => acceptsFilter(record, filter, conversions));
}

export function resolvePlanRecord(
  record: DataRecord,
  plan: QueryPlan,
  conversions: ConversionRegistry = {},
): ResolvedPlanRecord | undefined {
  if (excludedByCrossFieldRules(record, plan, conversions)) return undefined;
  if (!plan.spec.filters.every((filter) => acceptsFilter(record, filter, conversions))) return undefined;
  const row = resolveDimensionValue(record, plan.spec.rows, conversions);
  if (!row.key || row.label === undefined) return undefined;
  const column = plan.spec.columns
    ? resolveDimensionValue(record, plan.spec.columns, conversions)
    : { key: '__single__', label: singleColumnLabel(plan) };
  if (!column.key || column.label === undefined) return undefined;
  return { rowKey: row.key, rowLabel: row.label, columnKey: column.key, columnLabel: column.label };
}

function propagateRowSubtotals(rows: ResultAxisItem[], cells: number[][]): void {
  const indexByKey = new Map(rows.map((row, index) => [row.key, index]));
  const rowByKey = new Map(rows.map((row) => [row.key, row]));
  const depthMemo = new Map<string, number>();

  const depth = (key: string, trail = new Set<string>()): number => {
    const cached = depthMemo.get(key);
    if (cached !== undefined) return cached;
    // CNV com defeito que aponta uma linha para ela mesma (CID10_01_ST.CNV do
    // SIM: "0455 0455") ou num ciclo maior: o TabWin tabula mesmo assim. O
    // ciclo é cortado aqui em vez de recusar a tabela inteira.
    if (trail.has(key)) return 0;
    trail.add(key);
    const target = rowByKey.get(key)?.subtotalTargetKey;
    const value = target && target !== key && rowByKey.has(target) ? 1 + depth(target, trail) : 0;
    trail.delete(key);
    depthMemo.set(key, value);
    return value;
  };

  // Deepest details move first. A parent therefore already contains all of its
  // descendants when it is propagated to a higher-level subtotal. A row that is
  // its own subtotal adds itself after its children — it doubles, exactly as
  // the TabWin shows (CID10_01_ST.CNV: B190 = 2 and B199 = 1 give 6 on the
  // "0537 0537" row; varredura de 2026-10-23).
  const ordered = [...rows].sort((a, b) => depth(b.key) - depth(a.key));
  for (const row of ordered) {
    const targetKey = row.subtotalTargetKey;
    if (!targetKey) continue;
    const sourceIndex = indexByKey.get(row.key);
    const targetIndex = indexByKey.get(targetKey);
    if (sourceIndex === undefined || targetIndex === undefined) continue;
    const source = cells[sourceIndex];
    const target = cells[targetIndex];
    if (!source || !target) continue;
    for (let c = 0; c < source.length; c++) {
      target[c] = (target[c] ?? 0) + (source[c] ?? 0);
    }
  }
}
export interface TabulationOptions {
  /**
   * Posição de leitura do TabWin para cada registro (índice na ordem em que
   * chegam). Só muda a ordem das linhas do Discriminar; sem ela, vale a ordem
   * de chegada. Ver `tabwinReadPosition`.
   */
  readPosition?: (index: number) => number;
}

export interface TabulationAccumulator {
  /** Feeds one bounded batch. Call as many times as needed. */
  push(records: Iterable<DataRecord>): void;
  /** Materializes the current result; the accumulator remains usable. */
  finish(): TabulationResult;
}

/**
 * Incremental form of {@link executeInMemory}.
 *
 * Peak memory is bounded by the number of distinct row x column combinations,
 * never by the number of records, so a national DBC can be tabulated from
 * bounded batches without the dataset ever being resident.
 *
 * Semantics are not a variant: {@link executeInMemory} is a thin wrapper over
 * this accumulator, so both paths are the same code. Per-cell additions still
 * happen in record order, which keeps floating-point results identical to the
 * previous implementation.
 */
export function createTabulationAccumulator(
  plan: QueryPlan,
  conversions: ConversionRegistry = {},
  options: TabulationOptions = {},
): TabulationAccumulator {
  const warnings = new Set(plan.warnings);
  const observedRows = new Map<string, string>();
  const observedColumns = new Map<string, string>();
  const firstSeen = new Map<string, number>();
  const totals = new Map<string, Map<string, number>>();
  let recordsSeen = 0;
  let recordsAccepted = 0;

  // Counted over every record seen, so the diagnostic describes the source and
  // not the subset that survived the ordinary filters.
  const rules = plan.spec.crossFieldRules ?? [];
  const ruleMatches = rules.map(() => 0);
  const measures = plan.spec.measures && plan.spec.measures.length > 1 ? plan.spec.measures : undefined;

  function push(records: Iterable<DataRecord>): void {
    for (const record of records) {
      recordsSeen++;
      rules.forEach((rule, index) => {
        if (crossFieldRuleMatches(record, rule, conversions)) ruleMatches[index]! += 1;
      });
      const resolved = resolvePlanRecord(record, plan, conversions);
      if (!resolved) continue;

      if (options.readPosition) {
        // A primeira vez na leitura do TabWin, que num DBC não é a primeira no arquivo.
        let position: number | undefined;
        for (const key of [resolved.rowKey, resolved.columnKey]) {
          if (!key.startsWith(UNCLASSIFIED_CODE_PREFIX)) continue;
          position ??= options.readPosition(recordsSeen - 1);
          const known = firstSeen.get(key);
          if (known === undefined || position < known) firstSeen.set(key, position);
        }
      }
      observedRows.set(resolved.rowKey, resolved.rowLabel);
      let row = totals.get(resolved.rowKey);
      if (!row) totals.set(resolved.rowKey, row = new Map<string, number>());
      if (measures) {
        // Each simultaneous increment (G017) is its own column, computed from
        // the same record — never confused with a column dimension's key.
        measures.forEach((measure, index) => {
          const key = measureColumnKey(index);
          row!.set(key, (row!.get(key) ?? 0) + measureValueFor(record, measure, warnings));
        });
      } else {
        observedColumns.set(resolved.columnKey, resolved.columnLabel);
        row.set(resolved.columnKey, (row.get(resolved.columnKey) ?? 0) + measureValueFor(record, plan.spec.measure, warnings));
      }
      recordsAccepted++;
    }
  }

  function finish(): TabulationResult {
    return materializeTabulation({
      plan, conversions, warnings, observedRows, observedColumns, totals,
      recordsSeen, recordsAccepted, rules, ruleMatches,
      ...(options.readPosition ? { order: { firstSeen } } : {}),
    });
  }

  return { push, finish };
}

interface TabulationState {
  plan: QueryPlan;
  conversions: ConversionRegistry;
  warnings: Set<string>;
  observedRows: Map<string, string>;
  observedColumns: Map<string, string>;
  totals: Map<string, Map<string, number>>;
  recordsSeen: number;
  recordsAccepted: number;
  rules: readonly CrossFieldRuleSpec[];
  ruleMatches: readonly number[];
  order?: DiscriminateOrder;
}

function materializeTabulation(state: TabulationState): TabulationResult {
  const {
    plan, conversions, warnings, observedRows, observedColumns, totals,
    recordsSeen, recordsAccepted, rules, ruleMatches, order,
  } = state;

  let rows = axisFromDimension(plan.spec.rows, conversions, observedRows, order);
  const measures = plan.spec.measures && plan.spec.measures.length > 1 ? plan.spec.measures : undefined;
  let columns = measures
    ? measures.map((measure, index): ResultAxisItem => ({
      key: measureColumnKey(index),
      label: measureColumnLabel(measure, plan),
      source: 'derived' as const,
    }))
    : plan.spec.columns
      ? axisFromDimension(plan.spec.columns, conversions, observedColumns, order)
      : [{ key: '__single__', label: singleColumnLabel(plan), source: 'raw' as const }];

  let cells = rows.map((row) => {
    const accumulated = totals.get(row.key);
    return columns.map((column) => accumulated?.get(column.key) ?? 0);
  });

  if (plan.spec.rows.conversionId) {
    // Antes de somar os filhos: o que caiu direto numa linha-subtotal entra no
    // Total, como no TabWin (directTotal; RE-003, CID10_BR do SIM).
    const targets = new Set(rows.map((row) => row.subtotalTargetKey).filter(Boolean));
    rows.forEach((row, index) => {
      const own = cells[index] ?? [];
      if (row.excludeFromTotal && targets.has(row.key) && own.some((value) => value !== 0)) {
        rows[index] = { ...row, directTotal: [...own] };
      }
    });
    propagateRowSubtotals(rows, cells);
  }

  if (plan.spec.suppressZeroRows) {
    const keep = cells.map((row) => row.some((value) => value !== 0));
    rows = rows.filter((_, index) => keep[index]);
    cells = cells.filter((_, index) => keep[index]);
  }

  // The legacy panel exposes row and column zero suppression independently.
  // Preserve the synthetic single measure column when no column dimension was
  // requested; column suppression applies only to a materialized column axis.
  if (plan.spec.suppressZeroColumns && plan.spec.columns) {
    const keep = columns.map((_, columnIndex) =>
      cells.some((row) => (row[columnIndex] ?? 0) !== 0));
    columns = columns.filter((_, index) => keep[index]);
    cells = cells.map((row) => row.filter((_, index) => keep[index]));
    // O total direto das linhas-subtotal acompanha as colunas que ficaram; sem
    // isso o Total de cada coluna saía deslocado (varredura de combinações:
    // CID10 cap 19S × Idade detalhada, sem a coluna "7 anos").
    rows = rows.map((row) => (row.directTotal
      ? { ...row, directTotal: row.directTotal.filter((_, index) => keep[index]) }
      : row));
  }
  // Sem nenhuma coluna com valor, o TabWin não deixa a tabela sem colunas: põe
  // uma "DUMMY" zerada e avisa "NENHUM REGISTRO SELECIONADO" (varredura de
  // combinações, 2026-10-24: Seleção que não pega nada, ou Coluna que só tem
  // não classificados).
  const noRecordsSelected = Boolean(plan.spec.columns) && columns.length === 0;
  if (noRecordsSelected) {
    columns = [{ key: '__dummy__', label: 'DUMMY', source: 'raw' }];
    cells = rows.map(() => [0]);
    rows = rows.map((row) => (row.directTotal ? { ...row, directTotal: [0] } : row));
    warnings.add('NENHUM REGISTRO SELECIONADO: nenhuma coluna ficou com valor.');
  }

  return {
    rows,
    columns,
    cells,
    warnings: [...warnings],
    recordsSeen,
    recordsAccepted,
    ...(noRecordsSelected ? { noRecordsSelected: true } : {}),
    ...(rules.length ? {
      dataQuality: rules.map((rule, index) => ({
        id: rule.id,
        label: rule.label,
        action: rule.action,
        matchedRecords: ruleMatches[index] ?? 0,
      })),
    } : {}),
  };
}

export function executeInMemory(
  records: Iterable<DataRecord>,
  plan: QueryPlan,
  conversions: ConversionRegistry = {},
  options: TabulationOptions = {},
): TabulationResult {
  const accumulator = createTabulationAccumulator(plan, conversions, options);
  accumulator.push(records);
  return accumulator.finish();
}

/**
 * Preenche o `recordSpan` das dimensões e filtros com CNV quando o TabWin leria
 * além do campo: o código da CNV é mais longo que o que sobra do campo a partir
 * da posição, ou o campo é numérico (o TabWin lê o número como estava escrito,
 * alinhado à direita). Campo de texto que comporta o código fica como está — a
 * leitura é a mesma.
 */
export function withRecordLayout(
  spec: TabulationSpec,
  layout: readonly RecordFieldLayout[],
  conversions: ConversionRegistry,
): TabulationSpec {
  const spanFor = <T extends { field: string; conversionId?: string; startPosition?: number; recordSpan?: RecordFieldLayout[] }>(item: T, selecao = false): T => {
    const { recordSpan: _old, ...rest } = item;
    const conversion = item.conversionId ? conversions[item.conversionId] : undefined;
    if (!conversion || 'kind' in conversion) return rest as T;
    // Faixas numéricas: só a Seleção lê o texto do registro (ver numericRangeSelectionText).
    const faixas = conversion.mode === 'numeric-ranges' && selecao;
    if (!faixas && conversion.mode !== 'short' && conversion.mode !== 'literal') return rest as T;
    const index = layout.findIndex((candidate) => candidate.field === item.field);
    if (index < 0) return rest as T;
    const own = layout[index]!;
    const needed = (item.startPosition ?? 1) - (faixas ? 0 : 1) + conversion.codeLength;
    if (!faixas && own.type.toUpperCase() === 'C' && needed <= own.length) return rest as T;
    const span: RecordFieldLayout[] = [];
    let covered = 0;
    for (let at = index; at < layout.length && (covered < needed || !span.length); at++) {
      span.push({ ...layout[at]! });
      covered += layout[at]!.length;
    }
    return { ...rest, recordSpan: span } as T;
  };
  // O TabWin acha o campo sem olhar maiúsculas: "CODMUNres" e "seriescmae" nos
  // DEFs do SIM (varredura de combinações, 2026-10-24). Aqui o nome vira o do DBF.
  const nomeReal = (field: string): string => layout.find((candidate) => candidate.field.toUpperCase() === field.toUpperCase())?.field ?? field;
  const comNome = <T extends { field: string }>(item: T): T => (nomeReal(item.field) === item.field ? item : { ...item, field: nomeReal(item.field) });
  const medida = (measure: MeasureSpec): MeasureSpec => ({
    ...measure,
    ...(measure.field ? { field: nomeReal(measure.field) } : {}),
    ...(measure.weightField ? { weightField: nomeReal(measure.weightField) } : {}),
  });
  return {
    ...spec,
    rows: spanFor(comNome(spec.rows)),
    ...(spec.columns ? { columns: spanFor(comNome(spec.columns)) } : {}),
    measure: medida(spec.measure),
    ...(spec.measures ? { measures: spec.measures.map(medida) } : {}),
    filters: spec.filters.map((filter) => spanFor(comNome(filter), true)),
  };
}
