/**
 * The TabWin 4.15 tabulation log — the "receita" a veteran already knows.
 *
 * Every tabulation in TabWin opens a "Log" window with an INI-like text, and
 * the same text is embedded at the top of a saved `.TAB`. Observed under Wine
 * on 2026-10-13 (docs/reverse-engineering/RE_002_PAINEL_TABULA.md):
 *
 * ```text
 * [Opções]
 * DEF=C:\TabWin\G001\TESTE.DEF
 * PATH=C:\TabWin\G001\RD*.DBC
 * Linha=Sexo
 * Coluna=Caráter              (only when a column is active)
 * Incremento=Freqüência       (one line per increment, in list order)
 * Incremento=Valor Total
 * Suprime_Linhas_Zeradas=true
 * Suprime_Colunas_Zeradas=true
 * Não_Classificados=0         (0 Ignorar · 1 Incluir · 2 Discriminar)
 * [Seleções_Ativas]
 * Raça parcial: Branca|Parda  (categories joined by "|"…)
 *     Preta|Indígena          (…wrapped past 79 characters, 4 spaces in)
 * [Arquivos]
 * RDAC2401.dbc
 * Registros_Processados= 4315
 * Tempo_Decorrido= 0:00
 * ```
 *
 * The wrap was measured on saved `.TAB` files during the combination sweep
 * (2026-10-24): a line of 79 characters stays whole, one that would reach 80
 * moves the next category to a new line indented by four spaces, without the
 * "|". The first category never moves, however long the line gets.
 *
 * Reading accepts the `.TAB` wrapper too (`NEW`, `Titulo1=`, `Titulo2=` and
 * the `;`-separated matrix after `[Arquivos]`), so "restaurar consulta" works
 * from either source.
 */

export type TabwinUnclassifiedCode = 0 | 1 | 2;

export interface TabwinLogSelection {
  label: string;
  categories: string[];
}

export interface TabwinLog {
  title?: string;
  subtitle?: string;
  def?: string;
  path?: string;
  row?: string;
  column?: string;
  increments: string[];
  suppressZeroRows?: boolean;
  suppressZeroColumns?: boolean;
  unclassified?: TabwinUnclassifiedCode;
  selections: TabwinLogSelection[];
  files: string[];
  recordsProcessed?: number;
  elapsed?: string;
}

function parseBoolean(value: string): boolean | undefined {
  const normalized = value.trim().toLowerCase();
  if (normalized === 'true') return true;
  if (normalized === 'false') return false;
  return undefined;
}

/** Keys are compared without accents and case, because DOS-era copies drop them. */
function keyOf(raw: string): string {
  return raw.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
}

export function parseTabwinLog(text: string): TabwinLog {
  const log: TabwinLog = { increments: [], selections: [], files: [] };
  let section = '';
  for (const rawLine of text.replace(/^\uFEFF/, '').split(/\r\n|\r|\n/)) {
    const line = rawLine.trimEnd();
    if (!line.trim()) continue;
    const header = /^\[(.+)\]\s*$/.exec(line.trim());
    if (header) {
      section = keyOf(header[1] ?? '');
      continue;
    }
    // The .TAB matrix starts with a quoted cell; nothing after it is log.
    if (line.startsWith('"')) break;

    if (section === 'selecoes_ativas') {
      // Indented line: one more category of the selection above it.
      const anterior = log.selections[log.selections.length - 1];
      if (/^\s/.test(line) && anterior) {
        anterior.categories.push(...line.split('|').map((value) => value.trim()).filter(Boolean));
        continue;
      }
      const separator = line.indexOf(':');
      if (separator <= 0) continue;
      const label = line.slice(0, separator).trim();
      const categories = line.slice(separator + 1).split('|').map((value) => value.trim()).filter(Boolean);
      log.selections.push({ label, categories });
      continue;
    }

    const equals = line.indexOf('=');
    if (equals < 0) {
      if (section === 'arquivos') log.files.push(line.trim());
      continue;
    }
    const key = keyOf(line.slice(0, equals));
    const value = line.slice(equals + 1).trim();
    switch (key) {
      case 'titulo1': log.title = value; break;
      case 'titulo2': log.subtitle = value; break;
      case 'def': log.def = value; break;
      case 'path': log.path = value; break;
      case 'linha': log.row = value; break;
      case 'coluna': log.column = value; break;
      case 'incremento': if (value) log.increments.push(value); break;
      case 'suprime_linhas_zeradas': {
        const parsed = parseBoolean(value);
        if (parsed !== undefined) log.suppressZeroRows = parsed;
        break;
      }
      case 'suprime_colunas_zeradas': {
        const parsed = parseBoolean(value);
        if (parsed !== undefined) log.suppressZeroColumns = parsed;
        break;
      }
      case 'nao_classificados': {
        const code = Number(value);
        if (code === 0 || code === 1 || code === 2) log.unclassified = code;
        break;
      }
      case 'registros_processados': {
        const count = Number(value.replace(/\D/g, ''));
        if (Number.isFinite(count) && value.trim()) log.recordsProcessed = count;
        break;
      }
      case 'tempo_decorrido': log.elapsed = value; break;
      default: break;
    }
  }
  return log;
}

/** Longest `[Seleções_Ativas]` line TabWin writes before wrapping (measured: 79 stays, 80 wraps). */
const SELECTION_LINE_WIDTH = 79;

/** Writes the log exactly in TabWin's layout and line order, with CRLF. */
export function serializeTabwinLog(log: TabwinLog): string {
  const lines: string[] = ['[Opções]'];
  if (log.def !== undefined) lines.push(`DEF=${log.def}`);
  if (log.path !== undefined) lines.push(`PATH=${log.path}`);
  if (log.row !== undefined) lines.push(`Linha=${log.row}`);
  if (log.column) lines.push(`Coluna=${log.column}`);
  for (const increment of log.increments) lines.push(`Incremento=${increment}`);
  lines.push(`Suprime_Linhas_Zeradas=${log.suppressZeroRows ? 'true' : 'false'}`);
  lines.push(`Suprime_Colunas_Zeradas=${log.suppressZeroColumns === false ? 'false' : 'true'}`);
  lines.push(`Não_Classificados=${log.unclassified ?? 0}`);
  if (log.selections.length) {
    lines.push('[Seleções_Ativas]');
    for (const selection of log.selections) {
      const [primeira = '', ...outras] = selection.categories;
      let linha = `${selection.label}: ${primeira}`;
      for (const categoria of outras) {
        if (linha.length + 1 + categoria.length > SELECTION_LINE_WIDTH) {
          lines.push(linha);
          linha = `    ${categoria}`;
        } else {
          linha += `|${categoria}`;
        }
      }
      lines.push(linha);
    }
  }
  lines.push('[Arquivos]');
  for (const file of log.files) lines.push(file);
  if (log.recordsProcessed !== undefined) lines.push(`Registros_Processados= ${log.recordsProcessed}`);
  if (log.elapsed !== undefined) lines.push(`Tempo_Decorrido= ${log.elapsed}`);
  return `${lines.join('\r\n')}\r\n`;
}

/** TabWin prints elapsed time as m:ss. */
export function formatTabwinElapsed(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.round(milliseconds / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}
