// Gera, em pasta temporária, um DBF sintético com todos os tipos que o
// DATASUS usa (texto com acento, número com decimais, inteiro, data, lógico e
// nulos) e o Parquet convertido dele, pelo conversor de verdade.
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { writeDbf } from '../../dist/packages/export/src/dbf-writer.js';
import { converter } from '../../scripts/dbc-para-parquet.mjs';

export const CAMPOS = [
  { name: 'MUNIC', type: 'C', length: 6, decimalCount: 0 },
  { name: 'NOME', type: 'C', length: 20, decimalCount: 0 },
  { name: 'VALOR', type: 'N', length: 10, decimalCount: 2 },
  { name: 'QTD', type: 'N', length: 4, decimalCount: 0 },
  { name: 'DT', type: 'D', length: 8, decimalCount: 0 },
  { name: 'OBITO', type: 'L', length: 1, decimalCount: 0 },
];

export const REGISTROS = [
  { MUNIC: '120040', NOME: 'Rio Branco', VALOR: 47.27, QTD: 2, DT: new Date(Date.UTC(2024, 0, 18)), OBITO: false },
  { MUNIC: '150140', NOME: 'Belém', VALOR: 1234.5, QTD: 0, DT: new Date(Date.UTC(2024, 1, 29)), OBITO: true },
  { MUNIC: '355030', NOME: 'São Paulo', VALOR: null, QTD: null, DT: null, OBITO: null },
  { MUNIC: null, NOME: 'Ignorado', VALOR: 0, QTD: 7, DT: new Date(Date.UTC(2023, 11, 31)), OBITO: false },
];

export async function criarParquetDeTeste() {
  const pasta = await mkdtemp(path.join(tmpdir(), 'tabsis-parquet-'));
  const dbf = path.join(pasta, 'TESTE01.dbf');
  await writeFile(dbf, writeDbf(REGISTROS, CAMPOS));
  const parquet = path.join(pasta, 'TESTE01.parquet');
  const resultado = await converter(dbf, parquet);
  return { pasta, dbf, parquet, resultado, dbfBytes: new Uint8Array(await readFile(dbf)), parquetBytes: new Uint8Array(await readFile(parquet)) };
}
