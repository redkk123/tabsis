/**
 * A ordem em que o TabWin 4.15 lê os registros — o que decide a ordem das
 * linhas do "Discriminar", que aparecem conforme o código surge na leitura.
 *
 * Medido (RE-004, 2026-10-14): Discriminar sobre N_AIH, que é único por
 * registro, com uma CNV que não reconhece nada, lista os 4.315 registros do
 * RDAC2401 na ordem em que o TabWin os leu. Num DBF é a ordem do arquivo. Num
 * DBC não: o TabWin descomprime em pedaços de 4.096 bytes e, em cada pedaço,
 * processa primeiro os registros que cabem inteiros nele e só depois o que
 * vinha partido do pedaço anterior (1 2 3 4 5 · 7 8 9 10 11 6 · 13 … 17 12 …).
 * Este modelo reproduz os 4.315, sem exceção.
 */

export const TABWIN_DBC_CHUNK_BYTES = 4096;

/**
 * Posição (a partir de 0) em que o TabWin processa o registro `index` de um
 * DBC. Os bytes contam a partir do primeiro registro (o cabeçalho do DBC não é
 * comprimido). Registro maior que um pedaço não tem caso medido: fica na ordem
 * do arquivo.
 */
export function tabwinDbcReadPosition(
  index: number,
  recordLength: number,
  recordCount: number,
  chunk = TABWIN_DBC_CHUNK_BYTES,
): number {
  if (recordLength <= 0 || recordLength > chunk) return index;
  const start = index * recordLength;
  const end = start + recordLength;
  const endChunk = Math.floor((end - 1) / chunk);
  if (Math.floor(start / chunk) < endChunk) {
    // Partido: vem depois dos registros inteiros do pedaço onde termina.
    const lastWhole = Math.floor(((endChunk + 1) * chunk) / recordLength) - 1;
    return Math.min(Math.max(lastWhole, index), recordCount - 1);
  }
  // Inteiro: passa à frente do registro partido que termina no seu pedaço.
  const boundary = endChunk * chunk;
  const straddlerEndsHere = endChunk > 0 && boundary % recordLength !== 0
    && Math.floor(boundary / recordLength) < index;
  return straddlerEndsHere ? index - 1 : index;
}

export interface SourceReadLayout {
  recordCount: number;
  /** Só para DBC: tamanho do registro, do cabeçalho do DBF. */
  recordLength?: number;
  dbc: boolean;
}

/**
 * Posição de leitura do TabWin para um índice global de registro, com os
 * arquivos na ordem em que são lidos (um depois do outro).
 */
export function tabwinReadPosition(sources: readonly SourceReadLayout[]): (index: number) => number {
  const starts: number[] = [];
  let total = 0;
  for (const source of sources) { starts.push(total); total += source.recordCount; }
  return (index) => {
    let at = sources.length - 1;
    while (at > 0 && starts[at]! > index) at--;
    const source = sources[at];
    if (!source) return index;
    const local = index - starts[at]!;
    return starts[at]! + (source.dbc && source.recordLength
      ? tabwinDbcReadPosition(local, source.recordLength, source.recordCount)
      : local);
  };
}
