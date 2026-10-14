import type { CnvDefinition, CnvMatch, CnvRuleLine } from './cnv-model.js';

function normalizeCode(raw: unknown, codeLength: number): string {
  if (raw === null || raw === undefined) return '';
  return String(raw).slice(0, codeLength);
}

function matchesRule(code: string, rule: CnvRuleLine): boolean {
  if (rule.exactCodes.includes(code)) return true;
  return rule.ranges.some((range) => code >= range.from && code <= range.to);
}

/**
 * Índice de um código curto (até 4 posições), como o TabWin 4.15 calcula —
 * decompilado (CnvIndiceCurto, 0x476c24; RE-004) e medido (RE-003 T1–T4,
 * RE-004 H e I):
 *
 * 1. se o primeiro caractere é espaço, todo espaço vira 0 (" 5 " → "050");
 * 2. se o primeiro caractere é letra (ou [ \\ ] ^ _ `), ele vale a posição
 *    dela (A/a = 1 … Z/z = 26) vezes 10^(resto) e sai da frente: `A01` = 101;
 * 3. o resto passa pelo `Val` do Delphi (aceita espaços na frente e sinal);
 *    se falhar, todo não-dígito vira 0 e tenta de novo (`1A1` = 101,
 *    `*50` = 50, `-` = 0, `---` = 0).
 *
 * O texto tem o tamanho que o TabWin leu: o campo inteiro, com os espaços do
 * fim, ou o pedaço da lista de códigos da CNV (que pode ser mais curto no fim
 * da linha). `-50` dá −50, índice que não existe — como no TabWin.
 */
export function shortCodeIndex(code: string, codeLength: number): number {
  let texto = code.length > codeLength ? code.slice(0, codeLength) : code;
  if (texto.length && texto[0] === ' ') texto = texto.replace(/ /g, '0');
  let frente = 0;
  const primeiro = texto.charCodeAt(0);
  if (texto.length && primeiro >= 0x41 && primeiro <= 0x7a) {
    const maiuscula = primeiro >= 0x61 ? primeiro - 0x20 : primeiro;
    frente = (maiuscula - 0x40) * 10 ** (texto.length - 1);
    texto = texto.slice(1);
  }
  let valor = valDelphi(texto);
  if (valor === undefined) valor = valDelphi(texto.replace(/[^0-9]/g, '0')) ?? 0;
  return frente + valor;
}

/** `Val` do Delphi para inteiro: espaços na frente, sinal, `$` hexadecimal; nada depois. */
function valDelphi(texto: string): number | undefined {
  const achado = /^ *([+-]?)(\$[0-9a-fA-F]+|[0-9]+)$/.exec(texto);
  if (!achado) return undefined;
  const numero = achado[2]!.startsWith('$') ? parseInt(achado[2]!.slice(1), 16) : parseInt(achado[2]!, 10);
  return achado[1] === '-' ? -numero : numero;
}

/**
 * A lista de códigos de uma linha da CNV curta, lida como o TabWin lê
 * (CnvCarrega, 0x47737c): de `codeLength` em `codeLength` caracteres; um
 * código só vale se depois dele vem vírgula, espaço ou o fim; hífen abre uma
 * faixa; vírgula avança; **espaço encerra a lista** — por isso "050, 300" só
 * registra o 050 (RE-004, teste I). Linha sem código nenhum registra o
 * índice 0, o branco.
 */
function lerAreaCurta(area: string, length: number, registrar: (de: number, ate: number) => void): void {
  const n = area.length;
  const em = (posicao: number): string => area[posicao - 1] ?? '';
  let pos = 1;
  do {
    const de = shortCodeIndex(area.slice(pos - 1, pos - 1 + length), length);
    pos += length;
    if (em(pos) === ',' || em(pos) === ' ' || n < pos) registrar(de, de);
    if (pos < n && em(pos) === '-') {
      pos += 1;
      const ate = shortCodeIndex(area.slice(pos - 1, pos - 1 + length), length);
      pos += length;
      if (de <= ate) registrar(de, ate);
    }
    if (em(pos) === ',') pos += 1;
  } while (em(pos) !== ' ' && pos <= n);
}

/** Tabela índice → posição da categoria, montada uma vez por CNV curta. */
const shortTables = new WeakMap<CnvDefinition, { table: Int32Array; categories: Map<number, number> }>();

function shortTable(definition: CnvDefinition): { table: Int32Array; categories: Map<number, number> } {
  const cached = shortTables.get(definition);
  if (cached) return cached;
  const length = definition.codeLength;
  const table = new Int32Array(33 * 10 ** (length - 1)).fill(-1);
  const categories = new Map<number, number>();
  definition.categories.forEach((category, position) => {
    if (!categories.has(category.sequence)) categories.set(category.sequence, position);
  });
  // Na CNV curta quem vem depois ganha: preencher na ordem do arquivo e deixar
  // a linha seguinte sobrescrever é exatamente essa regra.
  const rules = definition.precedence === 'first-match-wins' ? [...definition.rules].reverse() : definition.rules;
  for (const rule of rules) {
    const position = categories.get(rule.categorySequence);
    if (position === undefined) continue;
    if (rule.shortArea !== undefined) {
      // Como o TabWin: a área crua da linha, lida pelo mesmo laço.
      lerAreaCurta(rule.shortArea, length, (de, ate) => {
        for (let index = Math.max(de, 0); index <= ate && index < table.length; index++) table[index] = position;
      });
      continue;
    }
    // Definição montada sem a área crua (editor, testes antigos): usa os
    // códigos e faixas já separados — uma aproximação da leitura acima.
    for (const code of rule.exactCodes) if (!code.startsWith('-')) table[shortCodeIndex(code, length)] = position;
    for (const range of rule.ranges) {
      // Início " " é o branco ("    -zzzz"; RE-004); ponta vazia não é faixa.
      if ((!range.from.trim() && range.from !== ' ') || !range.to.trim()) continue;
      const from = shortCodeIndex(range.from, length);
      const to = shortCodeIndex(range.to, length);
      for (let index = from; index <= to; index++) table[index] = position;
    }
  }
  const built = { table, categories };
  shortTables.set(definition, built);
  return built;
}

/**
 * CNV literal como o TabWin 4.15 guarda e procura (decompilado: inserção em
 * 0x474120, faixa em 0x4742ac, busca em 0x473f64; confirmado nos testes
 * T5–T8 do RE-003). Uma lista ordenada de códigos, cada um com a categoria e
 * duas marcas, `start` e `end`:
 *
 * - código que já existe só troca de categoria (por isso quem vem depois ganha);
 * - código novo herda as marcas se os vizinhos formam uma faixa
 *   (`anterior.start === seguinte.end`, não zero);
 * - faixa = insere o início e o fim, depois marca `início.start` e `fim.end`
 *   com a categoria — sem percorrer o que fica no meio;
 * - busca: código exato devolve a categoria dele; senão, cai entre dois
 *   vizinhos, e é da faixa se `anterior.start === seguinte.end`.
 *
 * É isso que faz faixas sobrepostas dependerem da ordem (nudosePB.cnv do
 * SINAN). Códigos em largura fixa (`codeLength`), comparados como texto.
 */
interface LiteralEntry { key: string; value: number; start: number; end: number }

const literalTables = new WeakMap<CnvDefinition, LiteralEntry[]>();

function lowerBound(entries: readonly LiteralEntry[], key: string): number {
  let low = 0; let high = entries.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (entries[middle]!.key < key) low = middle + 1; else high = middle;
  }
  return low;
}

function literalInsert(entries: LiteralEntry[], key: string, value: number): void {
  const at = lowerBound(entries, key);
  const found = entries[at];
  if (found && found.key === key) { found.value = value; return; }
  const entry: LiteralEntry = { key, value, start: 0, end: 0 };
  entries.splice(at, 0, entry);
  const previous = entries[at - 1];
  const next = entries[at + 1];
  if (previous && next && previous.start !== 0 && previous.start === next.end) {
    entry.start = previous.start;
    entry.end = previous.start;
  }
}

function literalTable(definition: CnvDefinition): LiteralEntry[] {
  const cached = literalTables.get(definition);
  if (cached) return cached;
  const length = definition.codeLength;
  const fixed = (code: string): string => code.padEnd(length, ' ').slice(0, length);
  const entries: LiteralEntry[] = [];
  for (const rule of definition.rules) {
    const category = rule.categorySequence;
    const tokens = rule.literalTokens ?? [...rule.exactCodes, ...rule.ranges];
    for (const token of tokens) {
      if (typeof token === 'string') {
        if (token.trimStart().startsWith('-')) continue;
        literalInsert(entries, fixed(token), category);
      } else {
        if (!token.from.trim() || !token.to.trim()) continue;
        const from = fixed(token.from); const to = fixed(token.to);
        literalInsert(entries, from, category);
        literalInsert(entries, to, category);
        entries[lowerBound(entries, from)]!.start = category;
        entries[lowerBound(entries, to)]!.end = category;
      }
    }
  }
  literalTables.set(definition, entries);
  return entries;
}

function literalLookup(definition: CnvDefinition, code: string): number | undefined {
  const entries = literalTable(definition);
  const at = lowerBound(entries, code);
  const found = entries[at];
  if (found && found.key === code) return found.value;
  const previous = entries[at - 1];
  if (previous && found && previous.start !== 0 && previous.start === found.end) return previous.start;
  return undefined;
}

export interface ClassifyCnvOptions {
  /**
   * O valor veio de um campo de texto (DBF tipo C), então vale a leitura de
   * largura fixa do TabWin: branco é código, letra vira número. Para número
   * (DBF tipo N) a largura original do campo não é conhecida aqui, e a regra
   * antiga — comparar o texto — continua valendo. Padrão: verdadeiro.
   */
  textual?: boolean;
}

export function classifyCnv(definition: CnvDefinition, raw: unknown, options: ClassifyCnvOptions = {}): CnvMatch | undefined {
  if (definition.mode === 'numeric-ranges') {
    const value = typeof raw === 'number' ? raw : Number(String(raw).trim());
    if (!Number.isFinite(value)) return undefined;
    for (const rule of definition.rules) {
      if (rule.numericUpperInclusive !== undefined && value <= rule.numericUpperInclusive) {
        const category = definition.categories.find(
          (candidate) => candidate.sequence === rule.categorySequence,
        );
        return category ? { sequence: category.sequence, label: category.label } : undefined;
      }
    }
    return undefined;
  }

  if (definition.mode === 'short' && (options.textual ?? true) && typeof raw !== 'number' && raw !== undefined) {
    const { table } = shortTable(definition);
    // O dado tem a largura fixa do campo: o que falta à direita é espaço.
    const texto = (raw === null ? '' : String(raw)).padEnd(definition.codeLength, ' ');
    const position = table[shortCodeIndex(texto, definition.codeLength)] ?? -1;
    if (position < 0) return undefined;
    const category = definition.categories[position]!;
    return { sequence: category.sequence, label: category.label };
  }

  if (definition.mode === 'literal' && typeof raw !== 'number' && raw !== undefined) {
    const code = (raw === null ? '' : String(raw)).padEnd(definition.codeLength, ' ').slice(0, definition.codeLength);
    const sequence = literalLookup(definition, code);
    if (sequence === undefined) return undefined;
    const category = definition.categories.find((candidate) => candidate.sequence === sequence);
    return category ? { sequence: category.sequence, label: category.label } : undefined;
  }

  const code = normalizeCode(raw, definition.codeLength);
  if (!code) return undefined;

  const orderedRules =
    definition.precedence === 'first-match-wins'
      ? definition.rules
      : [...definition.rules].reverse();

  const matched = orderedRules.find((rule) => matchesRule(code, rule));
  if (!matched) return undefined;
  const category = definition.categories.find(
    (candidate) => candidate.sequence === matched.categorySequence,
  );
  return category ? { sequence: category.sequence, label: category.label } : undefined;
}
