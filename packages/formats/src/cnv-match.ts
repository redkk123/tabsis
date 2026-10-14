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
 * medido no programa real com DBFs e CNVs de teste (RE-003):
 *
 * - o código tem sempre `codeLength` caracteres; o que falta à direita é
 *   espaço, como no campo de largura fixa do DBF;
 * - 1ª posição: dígito vale ele mesmo; qualquer outro caractere vale os 5 bits
 *   baixos do código ASCII — `A`/`a` = 1 … `I` = 9, `J` = 10 … `Z` = 26, `@` e
 *   espaço = 0. Por isso `A01` e `101` são o mesmo código, e `J01` não colide
 *   com nenhum código numérico;
 * - demais posições: dígito vale ele mesmo, qualquer outra coisa vale 0
 *   (`1A1`, `1 1` e `101` são o mesmo código; campo em branco é `000`).
 *
 * O Help do TabWin diz "A a J valem 0 a 9"; o programa faz A = 1 e aceita
 * letras além do J. Vale o que o programa faz.
 */
export function shortCodeIndex(code: string, codeLength: number): number {
  const padded = code.slice(0, codeLength).padEnd(codeLength, ' ');
  let index = 0;
  for (let position = 0; position < codeLength; position++) {
    const char = padded.charCodeAt(position);
    const digit = char >= 0x30 && char <= 0x39 ? char - 0x30 : position === 0 ? char & 0x1f : 0;
    index = index * 10 + digit;
  }
  return index;
}

/** Tabela índice → posição da categoria, montada uma vez por CNV curta. */
const shortTables = new WeakMap<CnvDefinition, { table: Int32Array; categories: Map<number, number> }>();

function shortTable(definition: CnvDefinition): { table: Int32Array; categories: Map<number, number> } {
  const cached = shortTables.get(definition);
  if (cached) return cached;
  const length = definition.codeLength;
  const table = new Int32Array(32 * 10 ** (length - 1)).fill(-1);
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
    // "----" (e "-zz") é o marcador das linhas-título, sem código: para o
    // TabWin o hífen separa faixa, então isso não é código nenhum. Lido como
    // código, viraria 13000 (o "-" vale 13) e pegaria o CID M000 (RE-003).
    for (const code of rule.exactCodes) if (!code.startsWith('-')) table[shortCodeIndex(code, length)] = position;
    for (const range of rule.ranges) {
      if (!range.from.trim() || !range.to.trim()) continue;
      const from = shortCodeIndex(range.from, length);
      const to = shortCodeIndex(range.to, length);
      for (let index = from; index <= to; index++) table[index] = position;
    }
  }
  const built = { table, categories };
  shortTables.set(definition, built);
  return built;
}

/** CNV literal: código e faixas em largura fixa, comparados como texto; quem vem depois ganha. */
const literalTables = new WeakMap<CnvDefinition, {
  exact: Map<string, { position: number; order: number }>;
  ranges: Array<{ from: string; to: string; position: number; order: number }>;
}>();

function literalTable(definition: CnvDefinition) {
  const cached = literalTables.get(definition);
  if (cached) return cached;
  const length = definition.codeLength;
  const fixed = (code: string): string => code.padEnd(length, ' ').slice(0, length);
  const positions = new Map<number, number>();
  definition.categories.forEach((category, position) => {
    if (!positions.has(category.sequence)) positions.set(category.sequence, position);
  });
  const exact = new Map<string, { position: number; order: number }>();
  const ranges: Array<{ from: string; to: string; position: number; order: number }> = [];
  definition.rules.forEach((rule, order) => {
    const position = positions.get(rule.categorySequence);
    if (position === undefined) return;
    for (const code of rule.exactCodes) {
      if (code.trimStart().startsWith('-')) continue;
      exact.set(fixed(code), { position, order });
    }
    for (const range of rule.ranges) {
      if (!range.from.trim() || !range.to.trim()) continue;
      ranges.push({ from: fixed(range.from), to: fixed(range.to), position, order });
    }
  });
  const built = { exact, ranges };
  literalTables.set(definition, built);
  return built;
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
    const position = table[shortCodeIndex(raw === null ? '' : String(raw), definition.codeLength)] ?? -1;
    if (position < 0) return undefined;
    const category = definition.categories[position]!;
    return { sequence: category.sequence, label: category.label };
  }

  if (definition.mode === 'literal' && typeof raw !== 'number' && raw !== undefined) {
    const { exact, ranges } = literalTable(definition);
    const code = (raw === null ? '' : String(raw)).padEnd(definition.codeLength, ' ').slice(0, definition.codeLength);
    const firstWins = definition.precedence === 'first-match-wins';
    let best = exact.get(code);
    for (const range of ranges) {
      if (code < range.from || code > range.to) continue;
      if (!best || (firstWins ? range.order < best.order : range.order > best.order)) best = range;
    }
    if (!best) return undefined;
    const category = definition.categories[best.position]!;
    return { sequence: category.sequence, label: category.label };
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
