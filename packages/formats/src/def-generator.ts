/**
 * "Gera DEF" e "Gera CNV" do TabWin (Editar → Editar arquivo DEF ou CNV),
 * descritos no Help do TabWin v2: a partir dos campos marcados de um DBF, um
 * DEF pronto para ajustar e, para cada campo codificado, uma CNV com os códigos
 * que existem no arquivo, esperando só a descrição de cada um.
 *
 * O texto exato que o TabWin gera não foi capturado; o que sai daqui segue a
 * sintaxe documentada e já lida pelo TabSis: campo de texto vira `X` (Linhas,
 * Colunas e Seleções — RE-002) com a CNV de mesmo nome do campo; campo
 * numérico vira `I` (Incremento).
 */

import type { CnvDefinition } from './cnv-model.js';

export interface DefGeneratorField {
  name: string;
  /** Tipo xBase: C, N, F, I, D, L… */
  type: string;
  /** Nome na tela; sem ele, o nome do campo. */
  label?: string;
}

export interface GenerateDefOptions {
  /** Primeira linha do DEF, depois do ";". */
  title: string;
  /** Padrão da diretiva A, ex. `RD*.DBC`. */
  filePattern: string;
  fields: readonly DefGeneratorField[];
}

const NUMERIC_TYPES = new Set(['N', 'F', 'I', 'B', 'Y']);

function clean(text: string): string {
  // Vírgula separa os campos da linha do DEF e ";" abre comentário: nenhum dos
  // dois pode aparecer dentro do nome na tela.
  return text.replace(/[,;]/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Padrão do `A` a partir do nome de um arquivo do DATASUS: `RDAC2401.dbc` → `RDAC*.DBC`. */
export function defFilePattern(fileName: string): string {
  const match = /^(.*?)(\.[^.]+)?$/.exec(fileName.trim())!;
  const stem = match[1]!.replace(/\d+$/, '');
  const extension = (match[2] ?? '.DBF').toUpperCase();
  return `${stem.toUpperCase() || '*'}*${extension}`;
}

export function generateDef(options: GenerateDefOptions): string {
  if (!options.fields.length) throw new Error('marque ao menos um campo');
  const lines = [`;${clean(options.title) || 'DEF gerado pelo TabSis'}`, `A${options.filePattern}`];
  const numeric = options.fields.filter((field) => NUMERIC_TYPES.has(field.type.toUpperCase()));
  const coded = options.fields.filter((field) => !NUMERIC_TYPES.has(field.type.toUpperCase()));
  for (const field of coded) {
    lines.push(`X${clean(field.label ?? field.name) || field.name},${field.name},1,${field.name}.CNV`);
  }
  for (const field of numeric) {
    lines.push(`I${clean(field.label ?? field.name) || field.name},${field.name}`);
  }
  return `${lines.join('\r\n')}\r\n`;
}

/**
 * Uma CNV com um código por categoria, na ordem dos códigos, e o próprio
 * código como descrição provisória. Código de até 4 posições fica curto, mais
 * que isso fica literal — a mesma regra do cabeçalho de CNV.
 */
export function generateCnvFromValues(values: readonly string[]): CnvDefinition {
  const codes = [...new Set(values.map((value) => value.replace(/ +$/, '')).filter((value) => value.trim()))]
    .sort((a, b) => a.localeCompare(b, 'pt-BR', { numeric: true }));
  if (!codes.length) throw new Error('o campo não tem valores para gerar a CNV');
  if (codes.some((code) => code.includes(',') || code.includes(';'))) {
    throw new Error('há códigos com vírgula ou ponto e vírgula, que a CNV não consegue representar');
  }
  const codeLength = Math.max(...codes.map((code) => code.length));
  return {
    categoryCount: codes.length,
    codeLength,
    mode: codeLength > 4 ? 'literal' : 'short',
    precedence: codeLength > 4 ? 'first-match-wins' : 'last-match-wins',
    categories: codes.map((code, index) => ({ sequence: index + 1, label: code })),
    rules: codes.map((code, index) => ({
      categorySequence: index + 1, exactCodes: [code], ranges: [], sourceOrder: index, sourceLine: index + 2,
    })),
    comments: [],
    warnings: [],
    headerLine: 1,
  };
}
