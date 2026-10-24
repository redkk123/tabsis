export type CompatibilityProfile = 'tabwin-4.15' | 'modern';

export interface SourceFingerprint {
  name: string;
  size: number;
  sha256: string;
  source: 'local' | 'official' | 'mirror';
  sourceUrl?: string;
}

/** Um campo do registro de largura fixa do DBF, na ordem do arquivo. */
export interface RecordFieldLayout {
  field: string;
  /** Tipo xBase: C, N, F, D, L… */
  type: string;
  length: number;
  decimals: number;
}

export interface DimensionSpec {
  field: string;
  conversionId?: string;
  /** Related DBF lookup materialized from a DEF option (for example CNES -> NOMEFANT). */
  lookupId?: string;
  /** 1-based initial character position inside the source field, as in DEF Campo D. */
  startPosition?: number;
  /**
   * O campo e os seguintes do registro de largura fixa do DBF, quando o código
   * da CNV passa do fim do campo ou o campo é numérico. O TabWin lê os
   * caracteres a partir da posição do campo, atravessando para o vizinho: no
   * SIH, `COD_IDADE` (1) + `IDADE` (2) formam o código de 3 da Faixa etária
   * (RE-003). Preenchido por `withRecordLayout` a partir do cabeçalho do DBF.
   */
  recordSpan?: RecordFieldLayout[];
  /**
   * Explicit handling when a raw value is empty or has no CNV match.
   *
   * TabWin 4.15's "Não classificados" radio maps as follows (oracle and
   * decompiled classification routine, 2026-10-13, RE_002):
   * - Ignorar → `omit` (the default);
   * - Incluir → `discriminate`: ONE extra "Não classificados" row/column;
   * - Discriminar → `discriminate-codes` on rows: one extra row per distinct
   *   unclassified code, labelled with the code itself, in order of first
   *   appearance — but only when the CNV is literal (`L`, or codes longer than
   *   four characters) or the axis is a DBF lookup. A short CNV ignores them,
   *   exactly as TabWin did with RACA1.CNV. On columns TabWin treats
   *   Discriminar like Incluir, so callers pass `discriminate` there.
   */
  unclassifiedPolicy?: 'omit' | 'discriminate' | 'discriminate-codes';
}

/** Immutable, renderer-independent lookup table loaded from a DEF-related DBF. */
export interface DimensionLookupDefinition {
  kind: 'dbf-lookup';
  /**
   * Uma linha por categoria. Sem `codes`, a chave é o próprio código; com
   * `codes`, a categoria junta vários códigos (o TabWin agrupa pelo rótulo
   * quando o DEF repete o par rótulo/DBF: "CD_DESCR, DBF\S_CID.DBF").
   */
  entries: Array<{ key: string; label: string; codes?: string[] }>;
}

interface FilterSpecBase {
  field: string;
  /** Modern provenance marker; execution remains identical to an ordinary explicit filter. */
  origin?: 'data-quality';
  /** Include matches by default; exclude inverts the predicate. */
  mode?: 'include' | 'exclude';
  conversionId?: string;
  /** 1-based initial character position inside the source field, as in DEF Campo D. */
  startPosition?: number;
  /**
   * O campo e os seguintes do registro de largura fixa do DBF, quando o código
   * da CNV passa do fim do campo ou o campo é numérico. O TabWin lê os
   * caracteres a partir da posição do campo, atravessando para o vizinho: no
   * SIH, `COD_IDADE` (1) + `IDADE` (2) formam o código de 3 da Faixa etária
   * (RE-003). Preenchido por `withRecordLayout` a partir do cabeçalho do DBF.
   */
  recordSpan?: RecordFieldLayout[];
}

export type FilterSpec = FilterSpecBase & (
  | {
      kind?: 'categories';
      /** Category sequence ids when conversionId is present; otherwise raw values. */
      acceptedCategories: string[];
      /** Treat a missing CNV match as another selected category. */
      includeUnclassified?: boolean;
    }
  | {
      kind: 'numeric-range';
      minimum?: number;
      maximum?: number;
      includeMinimum?: boolean;
      includeMaximum?: boolean;
    }
);

/**
 * A record-level implausibility rule spanning more than one field.
 *
 * Single-field filters intersect, so they cannot express "this combination is
 * implausible": excluding A and excluding B keeps only records that are
 * neither, while the rule needs to reject records that are both. Conditions
 * reuse {@link FilterSpec} verbatim, so no new matching semantics exist here —
 * only the conjunction and the action are new.
 *
 * This is a modern, user-authored policy. The kernel never ships clinical
 * meaning of its own: it evaluates exactly the combination the user wrote.
 */
export interface CrossFieldRuleSpec {
  id: string;
  label: string;
  /** Every condition must accept the record for the rule to match. */
  conditions: FilterSpec[];
  /** `flag` only counts; `exclude` also removes the record from the tabulation. */
  action: 'flag' | 'exclude';
}

/** Per-rule outcome, counted over every record seen, not over the filtered subset. */
export interface DataQualityRuleOutcome {
  id: string;
  label: string;
  action: 'flag' | 'exclude';
  matchedRecords: number;
}

export type TotalPolicy =
  | 'none'
  | 'sum'
  | 'product'
  | 'mean'
  | 'initial'
  | 'final'
  | 'min'
  | 'max'
  | 'precalculated';

export interface MeasureSpec {
  kind: 'count' | 'sum';
  field?: string;
  /**
   * Column header for a sum, taken verbatim from the DEF increment (`I`)
   * whose field this is — "Valor Total" for `VAL_TOT`, not a generic word.
   * Established by G003 against the real engine, which labels the column with
   * the increment's own name. Absent when a sum runs over a raw field with no
   * DEF increment behind it; there is no TabWin precedent for that case, so
   * the executor falls back to a neutral header rather than inventing one.
   */
  label?: string;
  /** DEF G semantics: grouped records contribute this field instead of a literal 1 to frequency. */
  weightField?: string;
  totalPolicy?: TotalPolicy;
}

export interface TabulationSpec {
  compatibilityProfile: CompatibilityProfile;
  rows: DimensionSpec;
  columns?: DimensionSpec;
  measure: MeasureSpec;
  /**
   * DEF `I` allows several simultaneous increments — G017 proved the real
   * engine lays each out as its own column, in declared order, sharing one
   * row axis ("Hospital AC (CNES)" × Frequência + Valor Total + Óbitos).
   * When present with 2+ entries, this replaces the single synthetic column
   * `measure` would otherwise produce; `measure` itself stays required and
   * should equal `measures[0]`, so any code path that has not been taught
   * about `measures` still sees a coherent first measure instead of nothing.
   * Not yet proven in combination with an explicit column dimension, so
   * `compileQueryPlan` rejects that pairing until an oracle covers it.
   */
  measures?: MeasureSpec[];
  filters: FilterSpec[];
  suppressZeroRows?: boolean;
  suppressZeroColumns?: boolean;
  /** Modern, user-authored implausibility rules spanning more than one field. */
  crossFieldRules?: CrossFieldRuleSpec[];
}

export interface QueryPlan {
  version: 1;
  spec: TabulationSpec;
  warnings: string[];
}

export interface ResultAxisItem {
  key: string;
  label: string;
  source: 'raw' | 'conversion' | 'derived';
  subtotalTargetKey?: string;
  excludeFromTotal?: boolean;
  /** Explicit display policy for a post-tabulation derived column. */
  totalPolicy?: TotalPolicy;
  /** The total shown when `totalPolicy` is `precalculated` (TabWin "Pré Calculado"). */
  precalculatedTotal?: number;
  /** Fixed decimal places for this column (TabWin "Quadro → Decimais"); absent = the table setting. */
  decimals?: number;
  /**
   * Linha-subtotal que também tem códigos próprios: o que caiu direto nela, sem
   * passar por um filho. O TabWin conta isso no Total (CID10_BR.CNV do SIM:
   * "001-031" = A000-B999 pega a sepse A41, que nenhum filho cobre; RE-003).
   */
  directTotal?: number[];
}

export interface TabulationResult {
  rows: ResultAxisItem[];
  columns: ResultAxisItem[];
  cells: number[][];
  warnings: string[];
  recordsSeen: number;
  recordsAccepted: number;
  /** Present only when the spec declared cross-field rules, so existing
   *  golden and portable-table payloads stay byte-identical. */
  dataQuality?: DataQualityRuleOutcome[];
}

/**
 * "Notas técnicas" do TabWin (Help do TabWin v2): um texto preso a uma linha,
 * a uma coluna ou a uma célula (as duas chaves), até 32 por tabela, salvas com
 * ela e impressas no rodapé.
 */
export interface TechnicalNote {
  rowKey?: string;
  columnKey?: string;
  text: string;
}

export const MAX_TECHNICAL_NOTES = 32;

/** Recusa nota sem alvo, texto vazio ou longo demais, alvo repetido e mais de 32 notas. */
export function validateTechnicalNotes(value: unknown, where: string): asserts value is TechnicalNote[] {
  if (!Array.isArray(value) || value.length > MAX_TECHNICAL_NOTES) throw new Error(`invalid technical notes in ${where}`);
  const seen = new Set<string>();
  for (const note of value as Array<Record<string, unknown>>) {
    const rowKey = note?.rowKey; const columnKey = note?.columnKey;
    if (!note || typeof note.text !== 'string' || !note.text.trim() || note.text.length > 240
      || (rowKey !== undefined && (typeof rowKey !== 'string' || !rowKey))
      || (columnKey !== undefined && (typeof columnKey !== 'string' || !columnKey))
      || (rowKey === undefined && columnKey === undefined)) {
      throw new Error(`invalid technical note in ${where}`);
    }
    const target = `${rowKey ?? ''}\u0000${columnKey ?? ''}`;
    if (seen.has(target)) throw new Error(`duplicate technical note target in ${where}`);
    seen.add(target);
  }
}

export interface DerivedColumnSpec {
  key: string;
  label: string;
  /**
   * `precalculated` only for binary multiply/divide/percentage: the total is
   * the same operation applied to the column totals — what TabWin shows for
   * "Produto" and "Quociente" (manual do curso TabWin, fev/2011, p. 50).
   */
  totalPolicy: TotalPolicy;
  /**
   * Decimal places shown for the new column: the "Casas decimais" of TabWin's
   * Calcular indicador, or the ",00" of "Percentagem=c2/c1*100,00" in Nova
   * coluna (manual do curso TabWin, fev/2011, p. 48 and 55–56).
   */
  decimals?: number;
}

export type TableOperation =
  | {
      kind: 'binary';
      operator: 'add' | 'subtract' | 'multiply' | 'divide' | 'minimum' | 'maximum' | 'percentage';
      leftColumnKey: string;
      rightColumnKey: string;
      output: DerivedColumnSpec;
      divisionByZero: 'error' | 'zero';
    }
  | {
      kind: 'factor';
      sourceColumnKey: string;
      factor: number;
      output: DerivedColumnSpec;
    }
  | {
      kind: 'cumulative';
      sourceColumnKey: string;
      output: DerivedColumnSpec;
    }
  | {
      /**
       * TabWin "Operações → %percentagem": each value as a percentage of the
       * column total (the total that skips CNV subtotal detail rows). Decompiled
       * from percentagem1Click; TabWin heads the new column "%" + header.
       */
      kind: 'percent-of-total';
      sourceColumnKey: string;
      output: DerivedColumnSpec;
    }
  | {
      /**
       * TabWin "Somar", "Mínimo" and "Máximo" over two or more columns at once
       * (TabWin titles: "Soma", "Menor", "Maior"). The sum's total is the sum
       * of the column totals.
       */
      kind: 'aggregate-columns';
      operator: 'add' | 'minimum' | 'maximum';
      columnKeys: string[];
      output: DerivedColumnSpec;
    }
  | {
      /**
       * TabWin "Operações → Calcular indicador" (decompiled Indicador1Click):
       * numerator × 10^scalePower ÷ denominator per row, zero where the
       * denominator is zero; the column total is NOT a sum but the same ratio
       * over the column totals (total numerator × scale ÷ total denominator).
       */
      kind: 'indicator';
      numeratorColumnKey: string;
      denominatorColumnKey: string;
      /** 0..6: "por 1", "por 10", … "por 1.000.000", as the TabWin dialog offers. */
      scalePower: number;
      output: DerivedColumnSpec;
    }
  | {
      /**
       * TabWin "Operações → Normalizar": z-score over every row,
       * (x − média) ÷ desvio padrão amostral (n − 1). Decompiled from
       * Normalizar1Click; TabWin heads the new column "Z" + header and leaves
       * its total at zero.
       */
      kind: 'normalize';
      sourceColumnKey: string;
      output: DerivedColumnSpec;
    }
  | {
      kind: 'absolute';
      sourceColumnKey: string;
      output: DerivedColumnSpec;
    }
  | {
      kind: 'integer';
      sourceColumnKey: string;
      rounding: 'truncate' | 'round' | 'floor' | 'ceil';
      output: DerivedColumnSpec;
    }
  | {
      kind: 'sequence';
      start: number;
      step: number;
      /**
       * Number the rows by their rank in this order instead of their position
       * — TabWin's "clique no cabeçalho, depois Operações → Seqüência", the
       * way to list the "n" largest categories (manual, p. 54). Ties keep the
       * row order.
       */
      order?: { columnKey: string; direction: 'ascending' | 'descending' };
      output: DerivedColumnSpec;
    }
  | {
      kind: 'constant';
      value: number;
      output: DerivedColumnSpec;
    }
  | {
      kind: 'expression';
      expression: string;
      divisionByZero: 'error' | 'zero';
      output: DerivedColumnSpec;
    }
  | { kind: 'rename-column'; columnKey: string; label: string }
  | { kind: 'move-column'; columnKey: string; direction: 'left' | 'right' }
  | { kind: 'delete-column'; columnKey: string }
  /**
   * TabWin "Quadro → Tipo de total" (and "Operações → Recalcula total", which
   * is the same with `sum`). `precalculated` freezes the total each column
   * shows right now, so later operations no longer change it (manual, p. 54
   * and 57–58).
   */
  | { kind: 'set-total-policy'; columnKeys: string[]; totalPolicy: TotalPolicy }
  /** TabWin "Quadro → Decimais": fixed places per column; `null` returns to the table setting. */
  | { kind: 'set-decimals'; columnKeys: string[]; decimals: number | null }
  | { kind: 'transpose' }
  | {
      /** Self-contained, strict row-key join. This is a modern explicit policy until golden-tested. */
      kind: 'include-table';
      sourceLabel: string;
      requireMatchingLabels: boolean;
      /**
       * TabWin "Quadro → Fixar comprimento da chave": compare only the first N
       * characters of each row key, so a TabNet table keyed by the 7-digit IBGE
       * code joins a TabWin table keyed by the 6-digit one (manual do curso
       * TabWin, fev/2011, p. 59–60). Absent = whole key.
       */
      keyLength?: number;
      rows: Array<Pick<ResultAxisItem, 'key' | 'label'>>;
      columns: ResultAxisItem[];
      cells: number[][];
    }
  | { kind: 'suppress-rows'; rowKeys: string[] }
  | {
      kind: 'aggregate-rows';
      rowKeys: string[];
      outputRow: { key: string; label: string; excludeFromTotal: boolean };
      removeSources: boolean;
    };

export type DataRecord = Record<string, unknown>;
