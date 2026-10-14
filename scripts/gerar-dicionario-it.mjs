#!/usr/bin/env node
/**
 * Gera `packages/formats/src/datasus-dictionary-it.ts` a partir do que
 * `extrair-dicionario-it.py` tirou dos Informes Técnicos do DATASUS.
 *
 * Uso: node scripts/gerar-dicionario-it.mjs <sih.json> <sia.json> <cnes.json>
 *
 * Os informes vêm dentro dos próprios pacotes auxiliares oficiais
 * (TAB_SIH.zip, TAB_SIA.zip e TAB_CNES.zip, pasta Docs) e também em
 * ftp.datasus.gov.br/dissemin/publicos/<SISTEMA>/…/Doc.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const FONTES = {
  SIH: 'Informe Técnico SIH 2016-03 (IT_SIHSUS_1603.pdf), DATASUS',
  SIA: 'Informe Técnico SIASUS 2019-07, DATASUS',
  CNES: 'Informe Técnico CNES 2017-06 (IT_CNES_1706.pdf), DATASUS',
};
// Erros de digitação do próprio informe: o nome no arquivo é o da direita.
const APELIDOS = { SIH: { RD: { DI_INTER: 'DT_INTER', DESTAO: 'GESTAO', 'MÊS_CMPT': 'MES_CMPT' } } };

const dados = {};
for (const caminho of process.argv.slice(2)) {
  const { sistema, arquivos } = JSON.parse(readFileSync(caminho, 'utf8'));
  dados[sistema] = {};
  for (const [prefixo, campos] of Object.entries(arquivos)) {
    const saida = {};
    for (const [campo, descricao] of Object.entries(campos)) {
      saida[APELIDOS[sistema]?.[prefixo]?.[campo] ?? campo] = descricao;
    }
    dados[sistema][prefixo] = Object.fromEntries(Object.entries(saida).sort(([a], [b]) => a.localeCompare(b)));
  }
}
const total = Object.values(dados).flatMap((s) => Object.values(s)).reduce((n, c) => n + Object.keys(c).length, 0);
writeFileSync('packages/formats/src/datasus-dictionary-it.ts', `/**
 * Layout dos arquivos do SIH, SIA e CNES, transcrito dos Informes Técnicos do
 * DATASUS (${total} descrições). Gerado por scripts/gerar-dicionario-it.mjs a
 * partir de scripts/extrair-dicionario-it.py — não editar à mão.
 *
 * Fontes: ${Object.values(FONTES).join('; ')}.
 */

export const IT_SOURCES: Readonly<Record<string, string>> = ${JSON.stringify(FONTES, null, 2)};

/** Sistema → prefixo do arquivo (RD, PA, ST…) → campo → descrição do informe. */
export const IT_LAYOUTS: Readonly<Record<string, Readonly<Record<string, Readonly<Record<string, string>>>>>> = ${JSON.stringify(dados, null, 1)};
`);
console.log(`datasus-dictionary-it.ts: ${total} descrições`);
