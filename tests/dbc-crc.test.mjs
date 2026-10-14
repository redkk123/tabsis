import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { crc32Update } from '../dist/packages/acquisition/src/dbc-crc.js';

test('o CRC-32 é o mesmo do zip (valor de referência "123456789" → cbf43926)', () => {
  const bytes = new TextEncoder().encode('123456789');
  assert.equal(crc32Update(0, bytes).toString(16), 'cbf43926');
  // Em pedaços, o resultado é o mesmo: é assim que o DBC é conferido, em fluxo.
  const parcial = crc32Update(crc32Update(0, bytes.subarray(0, 4)), bytes.subarray(4));
  assert.equal(parcial.toString(16), 'cbf43926');
  assert.ok(createHash);
});
