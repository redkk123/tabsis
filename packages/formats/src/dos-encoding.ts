/**
 * Acentuação do DOS (página de código 850) em DBFs do DATASUS.
 *
 * O TabWin tem "Converte acentuação do DOS" e a opção "DBF com acentuação para
 * DOS" (`DBF_CP850=1` no TabWin.ini), porque parte dos DBFs auxiliares ainda
 * sai gravada em CP850. Medido em 2026-10-14 no pacote TAB_SIH: `HUF_MEC.dbf` e
 * `HUF_FILIAL.dbf` — usados pelo RD2008.DEF em "HU's MEC EBSERH" — estão em
 * CP850 ("Climério", "Brasília"); `P040601.dbf`, no mesmo pacote, está em
 * Windows-1252. Por isso a escolha é por arquivo, pelo conteúdo: ganha a
 * página de código em que os bytes acima de 0x7F viram mais letras do
 * português. Empate fica em Windows-1252, o padrão do formato.
 */

const CP850_HIGH =
  'ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜø£Ø×ƒáíóúñÑªº¿®¬½¼¡«»░▒▓│┤ÁÂÀ©╣║╗╝¢¥┐└┴┬├─┼ãÃ╚╔╩╦╠═╬¤ðÐÊËÈıÍÎÏ┘┌█▄¦Ì▀ÓßÔÒõÕµþÞÚÛÙýÝ¯´­±‗¾¶§÷¸°¨·¹³²■ ';

const LETRAS_PT = new Set('áéíóúâêôãõçàüÁÉÍÓÚÂÊÔÃÕÇÀÜ');

const decodificador1252 = new TextDecoder('windows-1252');

export type DbfTextEncoding = 'windows-1252' | 'cp850';

export function decodeCp850(bytes: Uint8Array): string {
  let texto = '';
  for (const byte of bytes) texto += byte < 0x80 ? String.fromCharCode(byte) : CP850_HIGH[byte - 0x80];
  return texto;
}

/** Qual página de código os bytes de texto deste DBF usam. */
export function detectDbfTextEncoding(dbf: Uint8Array): DbfTextEncoding {
  const headerLength = dbf.length >= 10 ? dbf[8]! | (dbf[9]! << 8) : 0;
  const corpo = dbf.subarray(Math.min(headerLength, dbf.length));
  const altos: number[] = [];
  for (const byte of corpo) if (byte >= 0x80) altos.push(byte);
  if (!altos.length) return 'windows-1252';
  const amostra = new Uint8Array(altos);
  let em1252 = 0;
  for (const caractere of decodificador1252.decode(amostra)) if (LETRAS_PT.has(caractere)) em1252++;
  let em850 = 0;
  for (const caractere of decodeCp850(amostra)) if (LETRAS_PT.has(caractere)) em850++;
  // Duas letras no mínimo: um ou dois bytes soltos não bastam para trocar de
  // página de código (CBO.dbf tem dois, e nenhuma leitura deles faz sentido).
  return em850 >= 2 && em850 > em1252 ? 'cp850' : 'windows-1252';
}

const PARA_1252 = (() => {
  // Byte CP850 → byte Windows-1252 com a mesma letra; '?' quando não existe.
  const tabela = new Uint8Array(256);
  for (let i = 0; i < 0x80; i++) tabela[i] = i;
  const reverso = new Map<string, number>();
  for (let b = 0x80; b <= 0xff; b++) {
    const c = decodificador1252.decode(new Uint8Array([b]));
    if (!reverso.has(c)) reverso.set(c, b);
  }
  for (let b = 0x80; b <= 0xff; b++) tabela[b] = reverso.get(CP850_HIGH[b - 0x80]!) ?? 0x3f;
  return tabela;
})();

/**
 * Regrava os registros de um DBF em CP850 como Windows-1252, deixando o
 * cabeçalho intacto, para qualquer leitor de DBF ler os acentos certos.
 */
export function transcodeDbfCp850ToWindows1252(dbf: Uint8Array): Uint8Array {
  const headerLength = dbf[8]! | (dbf[9]! << 8);
  const saida = dbf.slice();
  for (let i = headerLength; i < saida.length; i++) saida[i] = PARA_1252[saida[i]!]!;
  return saida;
}
