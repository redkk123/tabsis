import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CACHE_FALLBACK_BUDGET_BYTES,
  CACHE_HARD_LIMIT_BYTES,
  cacheBudgetBytes,
  chooseCacheEvictions,
  describeCacheUsage,
} from '../dist/packages/acquisition/src/cache-policy.js';

const MB = 1024 * 1024;

test('o teto vem da cota do navegador, sem contar o próprio cache como alheio', () => {
  // 2 GB de cota, 300 MB usados dos quais 200 MB são do próprio cache:
  // os outros 100 MB ficam fora, metade do resto é o teto.
  assert.equal(cacheBudgetBytes({ quota: 2048 * MB, usage: 300 * MB }, 200 * MB), Math.floor((2048 - 100) * MB * 0.5));
  // Cota enorme não passa do teto fixo.
  assert.equal(cacheBudgetBytes({ quota: 100_000 * MB, usage: 0 }, 0), CACHE_HARD_LIMIT_BYTES);
  // Sem estimativa (modo privado, navegador antigo), um teto prudente.
  assert.equal(cacheBudgetBytes(null, 0), CACHE_FALLBACK_BUDGET_BYTES);
});

test('sai o mais antigo até caber, e o recém-baixado nunca sai', () => {
  const entradas = [
    { key: 'velho', size: 400 * MB, savedAt: 1 },
    { key: 'meio', size: 300 * MB, savedAt: 2 },
    { key: 'novo', size: 500 * MB, savedAt: 3 },
  ];
  assert.deepEqual(chooseCacheEvictions(entradas, 900 * MB, { keep: 'novo' }), ['velho']);
  assert.deepEqual(chooseCacheEvictions(entradas, 100 * MB, { keep: 'novo' }), ['velho', 'meio']);
  assert.deepEqual(chooseCacheEvictions(entradas, 5000 * MB, { keep: 'novo' }), []);
});

test('o teto de quantidade continua valendo', () => {
  const entradas = Array.from({ length: 5 }, (_, i) => ({ key: `k${i}`, size: 1, savedAt: i }));
  assert.deepEqual(chooseCacheEvictions(entradas, 10 ** 12, { keep: 'k4', maxEntries: 3 }), ['k0', 'k1']);
});

test('a descrição de uso é curta e em português', () => {
  assert.equal(describeCacheUsage(312 * MB, 1536 * MB), '312 MB de 1,5 GB');
});
