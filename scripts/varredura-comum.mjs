/**
 * Peças comuns da varredura TabSis × TabWin de combinações (Linha, Colunas,
 * Incrementos, Seleções): carrega a pasta de dados do TabWin (G001, SIM…), o
 * arquivo de dados e as CNV/DBF que um DEF pede, e monta o painel do TabSis.
 */
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { dbcToDbf, readDbfHeader, readDbfRecords } from '@precisa-saude/datasus-dbc';
import { detectDbfTextEncoding, parseCnv, parseDef, transcodeDbfCp850ToWindows1252 } from '../dist/packages/formats/src/index.js';
import { catalogoDoDef, lookupDefinitionFromDefOption, nomeBaseDoRecurso } from '../dist/packages/core/src/index.js';

export const cp1252 = new TextDecoder('windows-1252');

export async function abrirPasta(pasta, dadosNome) {
  const arquivos = new Map();
  for (const sub of [pasta, path.join(pasta, 'CNV'), path.join(pasta, 'DBF')]) {
    try { for (const nome of await readdir(sub)) if (!arquivos.has(nome.toLowerCase())) arquivos.set(nome.toLowerCase(), path.join(sub, nome)); } catch { /* opcional */ }
  }
  const relativo = path.join(pasta, dadosNome.replace(/\\/g, '/'));
  const dadosPath = (await stat(relativo).then(() => true, () => false)) ? relativo : arquivos.get(dadosNome.toLowerCase());
  let dadosBytes = new Uint8Array(await readFile(dadosPath));
  if (/\.dbc$/i.test(dadosPath)) dadosBytes = dbcToDbf(dadosBytes);
  const layout = readDbfHeader(dadosBytes).fields.map((f) => ({ field: f.name, type: f.type, length: f.length, decimals: f.decimalCount }));
  const registros = [];
  for await (const r of readDbfRecords(dadosBytes)) registros.push(r);
  const campos = new Set(layout.map((f) => f.field.toUpperCase()));

  const cnvs = new Map();
  const lookups = new Map();
  const ilegiveis = new Set();
  const existe = (arquivo) => arquivos.has(nomeBaseDoRecurso(arquivo)) && !ilegiveis.has(nomeBaseDoRecurso(arquivo));

  async function carregarOpcao(opcao) {
    if (opcao.kind === 'conversion' && existe(opcao.conversionFile)) {
      const chave = nomeBaseDoRecurso(opcao.conversionFile);
      // CNV que nem o TabSis lê (o próprio TabWin recusa essas): fica de fora.
      if (!cnvs.has(chave) && !ilegiveis.has(chave)) {
        try { cnvs.set(chave, parseCnv(cp1252.decode(await readFile(arquivos.get(chave))), { strict: false })); } catch { ilegiveis.add(chave); }
      }
    }
    if (opcao.kind === 'dbf-lookup' && existe(opcao.lookupFile)) {
      const chave = nomeBaseDoRecurso(opcao.lookupFile);
      if (!lookups.has(chave)) {
        let bytes = new Uint8Array(await readFile(arquivos.get(chave)));
        if (detectDbfTextEncoding(bytes) === 'cp850') bytes = transcodeDbfCp850ToWindows1252(bytes);
        const recs = [];
        for await (const r of readDbfRecords(bytes)) recs.push(r);
        lookups.set(chave, lookupDefinitionFromDefOption(opcao, recs));
      }
    }
  }

  /** Painel do TabSis para um DEF; `carregar` lê as CNV/DBF dele antes. */
  async function painel(defTexto, { carregar = true } = {}) {
    const def = parseDef(defTexto);
    if (carregar) for (const opcao of def.options) await carregarOpcao(opcao);
    const recursos = carregar
      ? {
        conversao: (f) => (cnvs.has(nomeBaseDoRecurso(f)) ? nomeBaseDoRecurso(f) : undefined),
        lookup: (f) => (lookups.has(nomeBaseDoRecurso(f)) ? nomeBaseDoRecurso(f) : undefined),
      }
      // Sem carregar: basta o arquivo existir (para listar o que dá para sortear).
      : { conversao: (f) => (existe(f) ? nomeBaseDoRecurso(f) : undefined), lookup: (f) => (existe(f) ? nomeBaseDoRecurso(f) : undefined) };
    return { def, catalogo: catalogoDoDef(def, recursos, campos) };
  }

  const registry = () => ({ ...Object.fromEntries(cnvs), ...Object.fromEntries(lookups) });
  return { arquivos, layout, registros, campos, cnvs, lookups, carregarOpcao, painel, registry, existe };
}
