/**
 * "Testar CRC" do TabWin: confere se o DBC descomprime exatamente no DBF que
 * foi comprimido.
 *
 * Os 4 bytes logo depois do cabeçalho de um `.dbc` são o CRC-32 (o mesmo do
 * zip, gravado little-endian) do `.dbf` inteiro — cabeçalho mais registros,
 * descomprimidos. Medido em 2026-10-13 em RDAC2401.dbc e DOINF23.dbc: o valor
 * gravado bate com o CRC-32 do DBF que o leitor reconstrói, e não com o do
 * trecho comprimido nem com o dos registros sozinhos.
 *
 * Um arquivo cortado ou corrompido no meio do caminho costuma descomprimir
 * "alguma coisa"; sem esta conta, o erro só apareceria como números estranhos
 * na tabela. É a mesma checagem da caixa "Testar CRC" do painel do TabWin.
 */

import { readDbcMetadata } from '@precisa-saude/datasus-dbc';
import { implodeDecompressChunks } from './implode-stream.js';

const TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32Update(crc: number, bytes: Uint8Array): number {
  let c = ~crc >>> 0;
  for (let i = 0; i < bytes.length; i++) c = TABLE[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8);
  return ~c >>> 0;
}

export interface DbcCrcReport {
  ok: boolean;
  /** CRC gravado no DBC, em hexadecimal. */
  stored: string;
  /** CRC do DBF descomprimido, em hexadecimal. */
  computed: string;
  decompressedBytes: number;
}

const hex = (value: number): string => value.toString(16).padStart(8, '0');

export function verifyDbcCrc(dbc: Uint8Array): DbcCrcReport {
  const metadata = readDbcMetadata(dbc);
  const header = dbc.subarray(0, metadata.headerSize);
  const view = new DataView(dbc.buffer, dbc.byteOffset + metadata.headerSize, 4);
  const stored = view.getUint32(0, true);
  const expectedRecordBytes = metadata.recordCount * metadata.recordSize + 1;
  let crc = crc32Update(0, header);
  let decompressed = 0;
  implodeDecompressChunks(dbc.subarray(metadata.headerSize + 4), expectedRecordBytes, (chunk) => {
    crc = crc32Update(crc, chunk);
    decompressed += chunk.byteLength;
  }, { allowMissingFinalByte: true });
  return { ok: crc === stored, stored: hex(stored), computed: hex(crc), decompressedBytes: decompressed };
}
