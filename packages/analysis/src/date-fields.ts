/**
 * Mês, ano e semana epidemiológica a partir dos campos de data do arquivo.
 *
 * Os arquivos do DATASUS guardam data como texto de oito dígitos, e cada
 * sistema num formato: SINAN e SIH em `AAAAMMDD` (`20230115`), SIM e SINASC em
 * `DDMMAAAA` (`15012023`). A semana epidemiológica do SINAN vem pronta em
 * campos como `SEM_NOT`, no formato `AAAASS` (`202303`).
 *
 * O formato não é adivinhado pelo nome do campo: é conferido numa amostra dos
 * valores, e só vale se (quase) todos baterem. Daí sai a posição de onde ler o
 * mês, o ano ou a semana, e uma tabela de conversão (CNV) comum faz o resto —
 * o mesmo mecanismo que o TabWin usa para ler parte de um campo.
 */

export type DateLayout = 'ymd' | 'dmy' | 'yw';

export interface DateFieldLike {
  name: string;
  type: string;
  length?: number;
}

/** Campos que podem ser data: tipo D, ou texto de 8 dígitos; ou semana (6 dígitos, nome SEM…). */
export function dateFieldCandidates(fields: readonly DateFieldLike[]): DateFieldLike[] {
  return fields.filter((field) => {
    const type = field.type.toUpperCase();
    if (type === 'D') return true;
    if (type !== 'C') return false;
    if (field.length === 8) return true;
    return field.length === 6 && /^SEM/i.test(field.name);
  });
}

const YMD = /^(19|20)\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])$/;
const DMY = /^(0[1-9]|[12]\d|3[01])(0[1-9]|1[0-2])(19|20)\d{2}$/;
const YW = /^(19|20)\d{2}(0[1-9]|[1-4]\d|5[0-3])$/;

/** O formato dos valores, se ao menos 90% da amostra (sem os vazios) bater com um só. */
export function detectDateLayout(field: DateFieldLike, sample: readonly string[]): DateLayout | null {
  if (field.type.toUpperCase() === 'D') return 'ymd';
  const valores = sample.map((value) => String(value ?? '').trim()).filter(Boolean);
  if (valores.length < 3) return null;
  const parcela = (padrao: RegExp) => valores.filter((value) => padrao.test(value)).length / valores.length;
  if (field.length === 6) return parcela(YW) >= 0.9 ? 'yw' : null;
  const ymd = parcela(YMD);
  const dmy = parcela(DMY);
  if (ymd >= 0.9 && ymd > dmy) return 'ymd';
  if (dmy >= 0.9 && dmy > ymd) return 'dmy';
  return null;
}

export type DatePart = 'mes' | 'ano' | 'semana';

/** De onde ler cada parte, no formato dado (posição começa em 1, como no DEF). */
export function datePartsFor(layout: DateLayout): Array<{ part: DatePart; startPosition: number }> {
  if (layout === 'ymd') return [{ part: 'mes', startPosition: 5 }, { part: 'ano', startPosition: 1 }];
  if (layout === 'dmy') return [{ part: 'mes', startPosition: 3 }, { part: 'ano', startPosition: 5 }];
  return [{ part: 'semana', startPosition: 5 }, { part: 'ano', startPosition: 1 }];
}

function cnvLine(sequence: number, label: string, codes: string): string {
  return `${''.padStart(3)}${String(sequence).padStart(4)}${''.padStart(2)}${label.padEnd(50)} ${codes}`;
}

const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
// Desde 1900: o ano de nascimento (NASC no SIH, DTNASC no SIM) vai longe.
export const PRIMEIRO_ANO = 1900;
export const ULTIMO_ANO = 2035;

/** O texto da CNV de cada parte, no formato do TabWin. */
export function datePartCnvText(part: DatePart): string {
  const linhas: string[] = [];
  if (part === 'mes') {
    MESES.forEach((mes, indice) => linhas.push(cnvLine(indice + 1, mes, String(indice + 1).padStart(2, '0'))));
    return [`${linhas.length} 2`, ...linhas].join('\r\n');
  }
  if (part === 'semana') {
    for (let semana = 1; semana <= 53; semana++) linhas.push(cnvLine(semana, `Semana ${String(semana).padStart(2, '0')}`, String(semana).padStart(2, '0')));
    return [`${linhas.length} 2`, ...linhas].join('\r\n');
  }
  for (let ano = PRIMEIRO_ANO; ano <= ULTIMO_ANO; ano++) linhas.push(cnvLine(ano - PRIMEIRO_ANO + 1, String(ano), String(ano)));
  return [`${linhas.length} 4`, ...linhas].join('\r\n');
}

export const DATE_PART_LABEL: Readonly<Record<DatePart, string>> = {
  mes: 'Mês',
  ano: 'Ano',
  semana: 'Semana epidemiológica',
};
