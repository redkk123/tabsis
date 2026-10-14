/**
 * Normalized representation of a TabWin definition file (.DEF).
 *
 * The representation is deliberately loss-aware: source line, directive and
 * unsupported lines are retained so compatibility work can be audited instead
 * of silently normalizing legacy semantics away.
 */

export type DefDirective = 'A' | 'R' | 'S' | 'L' | 'C' | 'Q' | 'D' | 'T' | 'X' | 'I' | 'G' | '?';
export type DefRole = 'selection' | 'row' | 'column' | 'quad';

export interface DefDataSource {
  pattern: string;
  /** TabWin 3.x+ optional SQL query associated with the A directive. */
  sqlQuery?: string;
  sourceLine: number;
}

interface DefOptionBase {
  /**
   * `X` is the contemporary shorthand for "line, column and selection at once".
   * Established on 2026-10-13 against the real TabWin 4.15 running under Wine:
   * an `X` option of `RD2008.DEF` ("Município internação") and of a purpose-built
   * DEF appeared in the Linhas, Colunas and Seleções disponíveis lists together,
   * in source order with the other directives. See docs/reverse-engineering/RE_002.
   */
  directive: 'S' | 'L' | 'C' | 'Q' | 'D' | 'T' | 'X';
  label: string;
  field: string;
  roles: DefRole[];
  sourceLine: number;
  /**
   * Additional comma-separated fields observed in contemporary real DEF files.
   * They are retained losslessly but have no executable semantics until a
   * documented rule or focused golden case establishes their meaning.
   */
  trailingFields?: string[];
}

/** Standard DEF option backed by a CNV conversion table. */
export interface DefConversionOption extends DefOptionBase {
  kind: 'conversion';
  /** 1-based initial character position inside the DBF field. */
  startPosition: number;
  conversionFile: string;
  /**
   * Texto que estava no lugar da posição inicial ("DS_TPFIN" em
   * `FAEC_TP,DS_TPFIN,CNV\TP_FINAN.CNV`). O TabWin 4.15 o ignora e lê a CNV a
   * partir da posição 1 (RE-004); fica guardado só para auditoria.
   */
  ignoredThirdField?: string;
}

/** Legacy option that relates the source field to another DBF lookup table. */
export interface DefDbfLookupOption extends DefOptionBase {
  kind: 'dbf-lookup';
  lookupLabelField: string;
  lookupFile: string;
}

/**
 * A related-resource lookup whose execution semantics are not documented well
 * enough to activate. Real 4.15 DEF files use this shape with both CNV and
 * other resource extensions. Keeping it distinct from DBF lookup prevents the
 * parser from lying about the resource type while retaining all source data.
 */
export interface DefExternalLookupOption extends DefOptionBase {
  kind: 'external-lookup';
  lookupLabelField: string;
  resourceFile: string;
}

export type DefOption = DefConversionOption | DefDbfLookupOption | DefExternalLookupOption;

export interface DefIncrement {
  label: string;
  field: string;
  sourceLine: number;
}

export interface DefUnknownLine {
  directive: string;
  raw: string;
  sourceLine: number;
}

export interface DefDefinition {
  /** First semicolon-comment description, per the historical manual. */
  description?: string;
  dataSources: DefDataSource[];
  options: DefOption[];
  increments: DefIncrement[];
  /** G directive: each record contributes the value of this field to frequency. */
  groupedCountField?: string;
  /** R directive, retained for old TABDOS compatibility even though Web does not use it. */
  reportFile?: string;
  /**
   * `?` directive: the help file the TabWin panel opens from its "Ajuda" button
   * (`?\TAB\RD.HLP` in RD2008.DEF). Kept so the panel can name it; WinHelp
   * itself is not reproduced.
   */
  helpFile?: string;
  comments: string[];
  unknownLines: DefUnknownLine[];
  warnings: string[];
}
