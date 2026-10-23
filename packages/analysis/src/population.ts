/**
 * População por município (e ano), para o mapa mostrar taxa por 100 mil
 * habitantes em vez de contagem — comparar lugares de tamanhos diferentes pela
 * contagem diz mais sobre o tamanho do lugar do que sobre a doença.
 *
 * O arquivo vem do IBGE pelo DATASUS (estimativas, censo) ou de onde a pessoa
 * tiver, em DBF ou CSV. As colunas não são adivinhadas pelo nome: a de
 * município é a que traz códigos do IBGE em (quase) todas as linhas, a de
 * população é a numérica de maior soma, e a de ano, se houver, a que traz anos.
 * Várias linhas do mesmo município (por sexo, por faixa etária) são somadas.
 */
import { ufCodeOf } from './geographic-fields.js';

export interface PopulationTable {
  /** Ano → município (6 dígitos) → habitantes. Sem coluna de ano, a chave é o ano do nome do arquivo (ou ''). */
  byYear: Map<string, Map<string, number>>;
  codeField: string;
  populationField: string;
  yearField?: string;
}

const ANO = /^(19[8-9]\d|20[0-4]\d)$/;

function numero(valor: unknown): number {
  if (typeof valor === 'number') return valor;
  const texto = String(valor ?? '').trim().replace(/\s/g, '');
  if (!texto) return Number.NaN;
  // "1.234.567" ou "1234567,0": pontos de milhar, vírgula decimal.
  const normal = /,\d+$/.test(texto) ? texto.replace(/\./g, '').replace(',', '.') : texto.replace(/\.(?=\d{3}(\D|$))/g, '');
  return Number(normal);
}

export function readPopulationTable(
  records: ReadonlyArray<Record<string, unknown>>,
  fieldNames: readonly string[],
  fileName = '',
): PopulationTable {
  if (!records.length) throw new Error('O arquivo de população está vazio.');
  const amostra = records.slice(0, 2000);
  const parcela = (campo: string, teste: (valor: unknown) => boolean) =>
    amostra.filter((registro) => teste(registro[campo])).length / amostra.length;

  const codeField = fieldNames.find((campo) => parcela(campo, (valor) => ufCodeOf(String(valor ?? '').trim()) !== null) >= 0.9);
  if (!codeField) throw new Error('Não achei uma coluna com códigos de município do IBGE neste arquivo.');
  const yearField = fieldNames.find((campo) => campo !== codeField && parcela(campo, (valor) => ANO.test(String(valor ?? '').trim())) >= 0.95);
  const numericos = fieldNames.filter((campo) => campo !== codeField && campo !== yearField
    && parcela(campo, (valor) => Number.isFinite(numero(valor))) >= 0.95);
  if (!numericos.length) throw new Error('Não achei uma coluna numérica de população neste arquivo.');
  const soma = (campo: string) => amostra.reduce((total, registro) => total + (Number.isFinite(numero(registro[campo])) ? numero(registro[campo]) : 0), 0);
  // A de nome POP… ganha o empate; senão, a de maior soma (a população é, de
  // longe, o maior número de uma linha de município).
  const populationField = numericos.find((campo) => /^POP/i.test(campo)) ?? [...numericos].sort((a, b) => soma(b) - soma(a))[0]!;

  const anoDoNome = /(?:^|\D)(\d{2})\.(?:dbf|dbc|csv)$/i.exec(fileName)?.[1];
  const anoPadrao = /(19|20)\d{2}/.exec(fileName)?.[0] ?? (anoDoNome ? `20${anoDoNome}` : '');
  const byYear = new Map<string, Map<string, number>>();
  for (const registro of records) {
    const codigo = String(registro[codeField] ?? '').trim();
    if (ufCodeOf(codigo) === null) continue;
    const habitantes = numero(registro[populationField]);
    if (!Number.isFinite(habitantes) || habitantes <= 0) continue;
    const ano = yearField ? String(registro[yearField] ?? '').trim() : anoPadrao;
    const tabela = byYear.get(ano) ?? new Map<string, number>();
    const chave = codigo.slice(0, 6);
    tabela.set(chave, (tabela.get(chave) ?? 0) + habitantes);
    byYear.set(ano, tabela);
  }
  if (!byYear.size) throw new Error('Nenhuma linha com município e população válidos.');
  return { byYear, codeField, populationField, ...(yearField ? { yearField } : {}) };
}

/** O ano da população para um período: o mesmo ano, se houver; senão o mais próximo (ou o único). */
export function populationYearFor(table: PopulationTable, periodLabel = ''): string {
  const anos = [...table.byYear.keys()];
  const alvo = /(19|20)\d{2}/.exec(periodLabel)?.[0];
  if (alvo && table.byYear.has(alvo)) return alvo;
  if (alvo) {
    const numericos = anos.filter((ano) => ANO.test(ano));
    if (numericos.length) return numericos.sort((a, b) => Math.abs(Number(a) - Number(alvo)) - Math.abs(Number(b) - Number(alvo)))[0]!;
  }
  return anos.sort().at(-1)!;
}

/** Habitantes de um município (6 ou 7 dígitos) ou de uma UF (2 dígitos: soma dos municípios). */
export function populationFor(table: PopulationTable, code: string, periodLabel = ''): number | undefined {
  const tabela = table.byYear.get(populationYearFor(table, periodLabel));
  if (!tabela) return undefined;
  const limpo = code.trim();
  if (/^\d{2}$/.test(limpo)) {
    let total = 0;
    for (const [municipio, habitantes] of tabela) if (municipio.startsWith(limpo)) total += habitantes;
    return total || undefined;
  }
  return tabela.get(limpo.slice(0, 6));
}

/** Casos por 100 mil habitantes; `undefined` sem população conhecida. */
export function ratePer100k(cases: number, population: number | undefined): number | undefined {
  return population && population > 0 ? (cases / population) * 100_000 : undefined;
}
