import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { readDbfRecords } from '@precisa-saude/datasus-dbc';
import { asyncBufferFromBytes, openParquetDataset, streamParquetRecords } from '../dist/packages/acquisition/src/parquet-source.js';
import { CAMPOS, criarParquetDeTeste } from './helpers/parquet-fixture.mjs';

test('o Parquet devolve os mesmos registros do DBF, valor e tipo', async () => {
  const { dbfBytes, parquetBytes, resultado } = await criarParquetDeTeste();
  const esperado = [];
  for await (const registro of readDbfRecords(dbfBytes)) esperado.push(registro);

  const arquivo = asyncBufferFromBytes(parquetBytes);
  const conjunto = await openParquetDataset(arquivo);
  assert.equal(conjunto.provenance.name, 'TESTE01.dbf');
  assert.equal(conjunto.provenance.sha256, createHash('sha256').update(dbfBytes).digest('hex'));
  assert.equal(conjunto.provenance.recordCount, 4);
  assert.deepEqual(conjunto.header.fields, CAMPOS);
  assert.ok(resultado.parquetBytes > 0);

  const lidos = [];
  await streamParquetRecords(arquivo, conjunto, ({ records }) => lidos.push(...records));
  assert.deepEqual(lidos, esperado);
});

test('a leitura traz só as colunas pedidas, como a projeção do leitor de DBF', async () => {
  const { parquetBytes } = await criarParquetDeTeste();
  const arquivo = asyncBufferFromBytes(parquetBytes);
  const conjunto = await openParquetDataset(arquivo);
  const lidos = [];
  await streamParquetRecords(arquivo, conjunto, ({ records }) => lidos.push(...records), { fields: ['NOME', 'NAO_EXISTE'], batchSize: 3 });
  assert.deepEqual(lidos.map((registro) => Object.keys(registro)), [['NOME'], ['NOME'], ['NOME'], ['NOME']]);
  assert.deepEqual(lidos.map((registro) => registro.NOME), ['Rio Branco', 'Belém', 'São Paulo', 'Ignorado']);
});

test('Parquet que não veio do conversor do TabSis é recusado com a razão', async () => {
  const { DuckDBInstance } = await import('@duckdb/node-api');
  const { mkdtemp, readFile } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const path = await import('node:path');
  const pasta = await mkdtemp(path.join(tmpdir(), 'tabsis-alheio-'));
  const destino = path.join(pasta, 'alheio.parquet');
  const conexao = await (await DuckDBInstance.create(':memory:')).connect();
  await conexao.run(`COPY (SELECT 1 AS x) TO '${destino}' (FORMAT parquet)`);
  await assert.rejects(
    openParquetDataset(asyncBufferFromBytes(new Uint8Array(await readFile(destino)))),
    /não foi gerado pelo TabSis/,
  );
});
