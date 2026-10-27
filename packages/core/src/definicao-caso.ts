/**
 * Definição de caso por códigos: "B57, sem B56".
 *
 * O caso que motivou: uma pesquisa de doença de Chagas precisou só do CID
 * B57. As listas prontas do DATASUS juntam B56 (doença do sono) e B57 em
 * "Tripanossomíase", e o SINAN não tem um agravo próprio para Chagas crônica.
 * Com isto, a pessoa escreve os códigos que quer e os que não quer, vê quantos
 * registros cada código traz e aplica como Seleção comum.
 *
 * A semântica é deliberadamente pequena, para caber numa frase na tela:
 *
 * - `B57` é prefixo: pega B57, B570, B571, … (é assim que se fala de CID).
 * - `B570-B575` é faixa: compara o começo do código com cada ponta, então
 *   `A90-A91` pega A90, A900 e A91X.
 * - Pontos, espaços e caixa não importam: `b57.0` é `B570`.
 * - Excluir vale por cima de incluir. Sem nada em incluir, inclui tudo e só
 *   exclui.
 *
 * Nenhum significado clínico vem embutido: o motor avalia exatamente os
 * códigos que a pessoa escreveu. A Seleção aplicada é a lista explícita dos
 * valores que casaram, a mesma que se marcaria à mão; o motor da tabela, que
 * bate com o TabWin, não muda.
 */

export interface RegraDeCodigo {
  /** Texto como a pessoa escreveu, para mostrar de volta. */
  texto: string;
  inicio: string;
  /** Igual a `inicio` quando é prefixo. */
  fim: string;
}

export interface DefinicaoDeCaso {
  incluir: RegraDeCodigo[];
  excluir: RegraDeCodigo[];
}

/** `b57.0` → `B570`. Valores do DBF chegam com espaços e, às vezes, ponto. */
export function normalizarCodigo(valor: string): string {
  return valor.toUpperCase().replace(/[\s.]/g, '');
}

/** Lê "B57, B570-B575; A90" (vírgula, ponto e vírgula, espaço ou linha). */
export function lerRegras(texto: string): RegraDeCodigo[] {
  const regras: RegraDeCodigo[] = [];
  // Uma faixa pode ter espaços em volta do hífen: junta antes de separar.
  const pedacos = texto.replace(/\s*-\s*/g, '-').split(/[\s,;]+/).filter(Boolean);
  for (const pedaco of pedacos) {
    const partes = pedaco.split('-');
    if (partes.length > 2) throw new Error(`Faixa inválida: "${pedaco}". Use início-fim, por exemplo B570-B575.`);
    const inicio = normalizarCodigo(partes[0]!.replace(/\*$/, ''));
    const fim = normalizarCodigo((partes[1] ?? partes[0]!).replace(/\*$/, ''));
    if (!inicio || !fim) throw new Error(`Código vazio em "${pedaco}".`);
    if (!/^[A-Z0-9]+$/.test(inicio) || !/^[A-Z0-9]+$/.test(fim)) {
      throw new Error(`"${pedaco}" tem caracteres que não existem em códigos (use letras e números).`);
    }
    if (fim.slice(0, inicio.length) < inicio.slice(0, fim.length)) {
      throw new Error(`Faixa invertida: "${pedaco}". O início vem antes do fim.`);
    }
    regras.push({ texto: pedaco, inicio, fim });
  }
  return regras;
}

export function lerDefinicao(incluir: string, excluir: string): DefinicaoDeCaso {
  return { incluir: lerRegras(incluir), excluir: lerRegras(excluir) };
}

export function regraCasa(regra: RegraDeCodigo, codigo: string): boolean {
  return codigo.slice(0, regra.inicio.length) >= regra.inicio && codigo.slice(0, regra.fim.length) <= regra.fim;
}

/** O valor do campo entra no caso? */
export function casaDefinicao(definicao: DefinicaoDeCaso, valor: string): boolean {
  const codigo = normalizarCodigo(valor);
  if (!codigo) return false;
  if (definicao.excluir.some((regra) => regraCasa(regra, codigo))) return false;
  return !definicao.incluir.length || definicao.incluir.some((regra) => regraCasa(regra, codigo));
}

export interface PreviaDeCaso {
  /** Valores que entram, com a contagem de registros, do maior para o menor. */
  entram: Array<{ valor: string; registros: number }>;
  registrosQueEntram: number;
  registrosQueFicamFora: number;
  /** Excluídos por uma regra de excluir que casou (o que o "sem B56" tirou). */
  excluidos: Array<{ valor: string; registros: number }>;
  /** Regras de incluir que não casaram com nenhum valor: provável erro de digitação. */
  regrasSemCasamento: string[];
}

/** Aplica a definição às contagens por valor (uma tabulação do campo, sem CNV). */
export function previaDeCaso(definicao: DefinicaoDeCaso, contagens: Iterable<{ valor: string; registros: number }>): PreviaDeCaso {
  const entram: PreviaDeCaso['entram'] = [];
  const excluidos: PreviaDeCaso['excluidos'] = [];
  const usadas = new Set<RegraDeCodigo>();
  let fora = 0;
  for (const { valor, registros } of contagens) {
    const codigo = normalizarCodigo(valor);
    const incluidaPor = codigo ? definicao.incluir.find((regra) => regraCasa(regra, codigo)) : undefined;
    if (incluidaPor) usadas.add(incluidaPor);
    if (casaDefinicao(definicao, valor)) {
      entram.push({ valor, registros });
    } else {
      fora += registros;
      if (codigo && (incluidaPor || !definicao.incluir.length) && definicao.excluir.some((regra) => regraCasa(regra, codigo))) {
        excluidos.push({ valor, registros });
      }
    }
  }
  const ordem = (a: { valor: string; registros: number }, b: { valor: string; registros: number }) =>
    b.registros - a.registros || a.valor.localeCompare(b.valor, 'pt-BR', { numeric: true });
  entram.sort(ordem);
  excluidos.sort(ordem);
  return {
    entram,
    registrosQueEntram: entram.reduce((soma, item) => soma + item.registros, 0),
    registrosQueFicamFora: fora,
    excluidos,
    regrasSemCasamento: definicao.incluir.filter((regra) => !usadas.has(regra)).map((regra) => regra.texto),
  };
}

/** Uma frase para a lista de Seleções e para a procedência. */
export function descreverDefinicao(definicao: DefinicaoDeCaso): string {
  const incluir = definicao.incluir.map((regra) => regra.texto).join(', ');
  const excluir = definicao.excluir.map((regra) => regra.texto).join(', ');
  if (incluir && excluir) return `${incluir}, sem ${excluir}`;
  if (incluir) return incluir;
  return excluir ? `tudo, sem ${excluir}` : 'tudo';
}

/**
 * RIDE-DF na composição da Lei Complementar nº 163/2018: o DF e 33 municípios
 * (29 de Goiás, 4 de Minas Gerais), em códigos IBGE de 6 dígitos, os do SINAN
 * e do SIM. Conferidos na API de localidades do IBGE em 25/10/2026.
 */
export const RIDE_DF_LC_163_2018: readonly string[] = [
  '530010',
  '520010', '520017', '520025', '520030', '520060', '520080', '520320', '520400', '520530', '520549',
  '520551', '520580', '520620', '520790', '520800', '520860', '521250', '521305', '521460', '521523',
  '521560', '521730', '521760', '521975', '522000', '522068', '522185', '522220', '522230',
  '310450', '310930', '310945', '317040',
];

/**
 * Faixa etária em anos completos, no código de idade do SINAN (`NU_IDADE_N`):
 * 4 dígitos, o primeiro é a unidade (1 hora, 2 dia, 3 mês, 4 ano) e os outros
 * três o valor. "0 a 9 anos" inclui quem tem a idade em horas, dias ou meses.
 */
export function faixaEtariaSinan(minimo: number, maximo: number): string {
  if (!Number.isInteger(minimo) || !Number.isInteger(maximo) || minimo < 0 || maximo > 999 || minimo > maximo) {
    throw new Error('Faixa etária inválida: use anos inteiros de 0 a 999, o início antes do fim.');
  }
  const ano = (valor: number) => `4${String(valor).padStart(3, '0')}`;
  const anos = minimo === maximo ? ano(minimo) : `${ano(minimo)}-${ano(maximo)}`;
  return minimo === 0 ? `1000-3999, ${anos}` : anos;
}
