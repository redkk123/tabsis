import assert from 'node:assert/strict';
import test from 'node:test';
import { ibgePopulacaoUrl, ibgeSeriePara, ibgeSeriesDisponiveis, lerPeriodosIbge, lerPopulacaoIbge } from '../dist/packages/analysis/src/ibge-population.js';

test('IBGE: cada ano usa a sua série, ou a mais próxima (empate: a mais antiga), e o Censo 2022 entra', () => {
  const series = ibgeSeriesDisponiveis(lerPeriodosIbge([{ id: '2009' }, { id: '2011' }, { id: '2021' }, { id: '2024' }]));
  assert.equal(ibgeSeriePara('2024', series).nome, 'Estimativa 2024');
  assert.equal(ibgeSeriePara('2023', series).nome, 'Censo 2022');
  assert.equal(ibgeSeriePara('2010', series).nome, 'Estimativa 2009');
  assert.equal(ibgePopulacaoUrl(ibgeSeriePara('2022', series)),
    'https://servicodados.ibge.gov.br/api/v3/agregados/4709/periodos/2022/variaveis/93?localidades=N6%5Ball%5D');
});

test('IBGE: lê município de 7 dígitos como 6, e recusa resposta com poucos municípios', () => {
  const resposta = (n) => [{ resultados: [{ series: Array.from({ length: n }, (_, i) => ({ localidade: { id: String(1100005 + i * 10) }, serie: { 2024: '100' } })) }] }];
  const lida = lerPopulacaoIbge(resposta(5570), '2024');
  assert.equal(lida.size, 5570);
  assert.equal(lida.get('110000'), 100);
  assert.throws(() => lerPopulacaoIbge(resposta(27), '2024'), /só 27 municípios/);
  assert.throws(() => lerPopulacaoIbge({ erro: 1 }, '2024'), /inesperada/);
});
