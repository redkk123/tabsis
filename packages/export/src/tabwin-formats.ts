/**
 * Os formatos do "Salvar como" do TabWin 4.15, copiados de arquivos que o
 * próprio TabWin gravou (2026-10-14, mesma tabela Sexo × Freqüência + Valor
 * Total salva em cada tipo; capturas antigas TO2…TO9 para Colunas e decimais):
 *
 * - `.TAB` (Tabela do TabWin): `NEW`, `Titulo1=`, `Titulo2=`, o log, e a
 *   matriz com `;`, rótulos entre aspas, vírgula decimal, sem separador de
 *   milhar; com Colunas, uma coluna "Total" no fim; a linha "Total" no fim;
 * - `.PRN` (Texto separado por vírgulas): a mesma matriz com `,` e ponto
 *   decimal, sem log;
 * - `.SQL` (SQL script): `CREATE TABLE` e um `INSERT` por linha, sem a linha
 *   de total.
 *
 * Tudo em Windows-1252 com CRLF (quem chama codifica). Assim uma tabela feita
 * no TabSis abre no TabWin de quem ainda o usa.
 */

import type { TabulationResult } from '../../core/src/model.js';

export interface TabwinFormatContext {
  /** Canto da tabela: o nome da variável de Linhas. */
  rowLabel: string;
  /** Titulo1 do TabWin (título do DEF ou o que a pessoa escreveu). */
  title?: string;
  /** Titulo2 ("Freqüência segundo Sexo"). */
  subtitle?: string;
  /** O log do TabWin ([Opções]…), quando a tabela veio do painel. */
  log?: string;
  /** Há uma variável em Colunas: o TabWin acrescenta a coluna "Total" (TO3). */
  rowTotalColumn?: boolean;
  /** Total de cada coluna como a tabela mostra (tipo de total); padrão: soma sem as linhas excluídas. */
  totals?: ReadonlyArray<number | undefined>;
}

/** Casas que cada coluna precisa: as fixadas nela, ou as menores que representam todos os valores (até 6). */
export function columnDecimals(result: TabulationResult, columnIndex: number): number {
  const fixed = result.columns[columnIndex]?.decimals;
  if (fixed !== undefined) return fixed;
  const values = result.cells.map((row) => row[columnIndex] ?? 0);
  for (let places = 0; places < 6; places++) {
    const scale = 10 ** places;
    // Tolerância do ponto flutuante só: 2077684.41 × 100 dá 207768441.00000003.
    if (values.every((value) => Math.abs(value * scale - Math.round(value * scale)) < Math.max(1e-9, Math.abs(value * scale) * 1e-12))) return places;
  }
  return 6;
}

function defaultTotals(result: TabulationResult): number[] {
  return result.columns.map((_, column) => result.cells.reduce((sum, cells, row) => {
    const axis = result.rows[row];
    return sum + (axis?.excludeFromTotal ? (axis.directTotal?.[column] ?? 0) : (cells[column] ?? 0));
  }, 0));
}

function quote(text: string): string {
  // O TabWin tira as aspas de dentro do rótulo ao salvar (CNAE.CNV: `"In Natura"`
  // sai `In Natura`; varredura de 2026-10-23).
  return `"${text.replace(/"/g, '')}"`;
}

function matrix(result: TabulationResult, context: TabwinFormatContext, separator: string, decimalMark: string): string[] {
  const decimals = result.columns.map((_, index) => columnDecimals(result, index));
  const number = (value: number | undefined, places: number): string => {
    if (value === undefined || !Number.isFinite(value)) return '';
    const text = value.toFixed(places);
    return decimalMark === '.' ? text : text.replace('.', decimalMark);
  };
  // Coluna "Total" só quando há Colunas, como no TO3; com vários incrementos o TabWin não soma.
  const rowTotal = Boolean(context.rowTotalColumn);
  const totalDecimals = Math.max(0, ...decimals);
  const totals = context.totals ?? defaultTotals(result);
  const lines = [[quote(context.rowLabel), ...result.columns.map((column) => quote(column.label)), ...(rowTotal ? [quote('Total')] : [])].join(separator)];
  result.rows.forEach((row, index) => {
    const cells = result.cells[index] ?? [];
    lines.push([
      quote(row.label),
      ...cells.map((value, column) => number(value, decimals[column]!)),
      ...(rowTotal ? [number(cells.reduce((sum, value) => sum + value, 0), totalDecimals)] : []),
    ].join(separator));
  });
  const grand = totals.reduce<number>((sum, value) => sum + (value ?? 0), 0);
  lines.push([
    quote('Total'),
    ...totals.map((value, column) => number(value, decimals[column]!)),
    ...(rowTotal ? [number(grand, totalDecimals)] : []),
  ].join(separator));
  return lines;
}

/** `.TAB`, a Tabela do TabWin: abre em "Arquivo → Abrir tabela" do TabWin 4.15. */
export function tabulationToTabwinTab(result: TabulationResult, context: TabwinFormatContext): string {
  const log = (context.log ?? `[Opções]\r\nLinha=${context.rowLabel}\r\n`)
    .replace(/\r?\n/g, '\r\n').replace(/(\r\n)+$/, '');
  const lines = [
    'NEW',
    `Titulo1=${(context.title ?? '').replace(/[\r\n]+/g, ' ')}`,
    `Titulo2=${(context.subtitle ?? '').replace(/[\r\n]+/g, ' ')}`,
    log,
    // O TabWin escreve o aviso entre o log e a matriz.
    ...(result.noRecordsSelected ? ['NENHUM REGISTRO SELECIONADO'] : []),
    ...matrix(result, context, ';', ','),
  ];
  return `${lines.join('\r\n')}\r\n`;
}

/** `.PRN`, o "Texto separado por vírgulas" do TabWin. */
export function tabulationToTabwinPrn(result: TabulationResult, context: TabwinFormatContext): string {
  return `${matrix(result, context, ',', '.').join('\r\n')}\r\n`;
}

function sqlName(text: string): string {
  const plain = text.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return /^[A-Za-z_]/.test(plain) ? plain : `c_${plain}`;
}

/** `.SQL`, o "SQL script" do TabWin: CREATE TABLE e um INSERT por linha, sem a linha de total. */
export function tabulationToTabwinSql(result: TabulationResult, context: TabwinFormatContext & { tableName: string }): string {
  const table = sqlName(context.tableName) || 'tabela';
  const decimals = result.columns.map((_, index) => columnDecimals(result, index));
  const width = Math.max(1, ...result.rows.map((row) => row.label.length));
  const names: string[] = [];
  const unique = (name: string): string => {
    let candidate = name; let n = 2;
    while (names.includes(candidate.toLowerCase())) candidate = `${name}_${n++}`;
    names.push(candidate.toLowerCase());
    return candidate;
  };
  const columns = [
    `  ${unique(sqlName(context.rowLabel).toLowerCase() || 'linha')} CHAR(${width})`,
    ...result.columns.map((column, index) => `  ${unique(sqlName(column.label) || `coluna_${index + 1}`)} Numeric(${11 + decimals[index]!},${decimals[index]})`),
  ];
  const lines = [`CREATE TABLE ${table} (`, `${columns.join(',\r\n')});`];
  result.rows.forEach((row, index) => {
    const values = (result.cells[index] ?? []).map((value, column) => value.toFixed(decimals[column]!));
    lines.push(`INSERT INTO ${table} VALUES('${row.label.replace(/'/g, "''")}',${values.join(',')});`);
  });
  return `${lines.join('\r\n')}\r\n`;
}
