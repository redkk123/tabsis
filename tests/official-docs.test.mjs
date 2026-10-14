import assert from 'node:assert/strict';
import test from 'node:test';
import { officialDocumentsFor } from '../dist/packages/acquisition/src/index.js';
import { describeDatasusFile } from '../dist/packages/formats/src/index.js';

const docs = (arquivo) => {
  const tipo = describeDatasusFile(arquivo);
  return officialDocumentsFor(tipo?.system, tipo?.prefix);
};

test('cada sistema tem a documentação oficial no FTP do DATASUS', () => {
  assert.deepEqual(docs('DOINF23.dbc').map((d) => d.address), ['ftp://ftp.datasus.gov.br/dissemin/publicos/SIM/CID10/DOCS/Estrutura_do_SIM_2025.pdf']);
  assert.equal(docs('DNAC2022.dbc')[0]?.name, 'Estrutura_SINASC_para_CD.pdf');
  assert.equal(docs('RDAC2401.dbc')[0]?.name, 'IT_SIHSUS_1603.pdf');
  assert.equal(docs('PAAC2501.dbc')[0]?.name, 'Informe_Tecnico_SIASUS_2019_07.pdf');
  assert.equal(docs('STAC2501.dbc')[0]?.name, 'IT_CNES_1706.pdf');
  assert.deepEqual(docs('dados.csv'), []);
});

test('SINAN: o dicionário do agravo e o da ficha, dentro do pacote de 65 MB (com o tamanho para avisar)', () => {
  const sinan = docs('HANSBR23.dbc');
  assert.deepEqual(sinan.map((d) => d.name), ['HANSN_DIC_DADOS.pdf', 'NINDIN_DIC_DADOS.pdf']);
  assert.ok(sinan.every((d) => d.address.endsWith('/SINAN/DOCS/Docs_TAB_SINAN.zip') && d.downloadBytes > 60_000_000));
  assert.equal(docs('DENGBR23.dbc')[0]?.name, 'DENGON_DIC_DADOS.pdf');
});
