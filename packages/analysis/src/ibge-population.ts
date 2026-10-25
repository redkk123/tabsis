/**
 * População por município direto da API do IBGE (servicodados.ibge.gov.br),
 * para a taxa por 100 mil sem precisar baixar arquivo de população.
 *
 * A API libera acesso do navegador (CORS `*`) e só recebe o ano e a tabela:
 * nenhum dado aberto no TabSis sai do aparelho. Séries usadas (conferidas em
 * 2026-10-25):
 * - Estimativas da população (tabela 6579, variável 9324): 2001–2006,
 *   2008–2009, 2011–2021, 2024 em diante — a lista vem da própria API;
 * - Censo 2022 (tabela 4709, variável 93), que cobre 2022 e o 2023 sem
 *   estimativa.
 * Ano sem série usa a mais próxima (empate: a mais antiga), e isso é dito.
 */
import type { PopulationTable } from './population.js';

export const IBGE_AGREGADOS = 'https://servicodados.ibge.gov.br/api/v3/agregados';

export interface IbgeSerie {
  tabela: string;
  variavel: string;
  ano: string;
  nome: string;
}

const CENSO_2022: IbgeSerie = { tabela: '4709', variavel: '93', ano: '2022', nome: 'Censo 2022' };

/** As séries disponíveis: as estimativas que a API listar, mais o Censo 2022. */
export function ibgeSeriesDisponiveis(anosDasEstimativas: readonly string[]): IbgeSerie[] {
  const estimativas = anosDasEstimativas
    .filter((ano) => /^\d{4}$/.test(ano))
    .map((ano) => ({ tabela: '6579', variavel: '9324', ano, nome: `Estimativa ${ano}` }));
  return [...estimativas, CENSO_2022].sort((a, b) => a.ano.localeCompare(b.ano));
}

/** A série para cada ano dos dados: a do próprio ano, ou a mais próxima. */
export function ibgeSeriePara(ano: string, series: readonly IbgeSerie[]): IbgeSerie | undefined {
  if (!series.length) return undefined;
  const alvo = Number(ano);
  return [...series].sort((a, b) => Math.abs(Number(a.ano) - alvo) - Math.abs(Number(b.ano) - alvo) || a.ano.localeCompare(b.ano))[0];
}

export function ibgePopulacaoUrl(serie: IbgeSerie): string {
  return `${IBGE_AGREGADOS}/${serie.tabela}/periodos/${serie.ano}/variaveis/${serie.variavel}?localidades=N6%5Ball%5D`;
}

export function ibgePeriodosUrl(): string {
  return `${IBGE_AGREGADOS}/6579/periodos`;
}

export function lerPeriodosIbge(resposta: unknown): string[] {
  if (!Array.isArray(resposta)) throw new Error('Resposta inesperada do IBGE (períodos).');
  return resposta.map((item) => String((item as { id?: unknown }).id ?? '')).filter((ano) => /^\d{4}$/.test(ano));
}

/** Município (6 dígitos) → habitantes, da resposta de `/agregados/…/variaveis/…`. */
export function lerPopulacaoIbge(resposta: unknown, ano: string): Map<string, number> {
  const resultado = Array.isArray(resposta) ? (resposta[0] as { resultados?: unknown } | undefined)?.resultados : undefined;
  const series = Array.isArray(resultado) ? (resultado[0] as { series?: unknown } | undefined)?.series : undefined;
  if (!Array.isArray(series)) throw new Error('Resposta inesperada do IBGE (população).');
  const porMunicipio = new Map<string, number>();
  for (const item of series as Array<{ localidade?: { id?: unknown }; serie?: Record<string, unknown> }>) {
    const codigo = String(item.localidade?.id ?? '');
    const habitantes = Number(item.serie?.[ano]);
    if (/^\d{7}$/.test(codigo) && Number.isFinite(habitantes) && habitantes > 0) porMunicipio.set(codigo.slice(0, 6), habitantes);
  }
  if (porMunicipio.size < 5000) throw new Error(`O IBGE devolveu só ${porMunicipio.size} municípios para ${ano}.`);
  return porMunicipio;
}

/** A tabela de população do TabSis, com cada ano dos dados apontando para a sua série. */
export function tabelaDoIbge(porAno: ReadonlyMap<string, Map<string, number>>): PopulationTable {
  return { byYear: new Map(porAno), codeField: 'código do IBGE', populationField: 'população (API do IBGE)' };
}
