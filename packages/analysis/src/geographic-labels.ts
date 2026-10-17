/**
 * Troca o código do IBGE pelo nome do lugar nos rótulos de uma tabela.
 *
 * Quem tabula por `CODMUNRES` lia `150140`, `355030`, `330455` — e tinha que
 * saber de cabeça (ou abrir uma planilha) que isso é Belém, São Paulo e Rio de
 * Janeiro. O mesmo vale para cada campo de município do arquivo (residência,
 * ocorrência, notificação, nascimento…): o DATASUS tem vários, todos em código.
 *
 * Não depende do NOME do campo, porque cada sistema batiza do seu jeito. A
 * prova é nos dados: o eixo só vira nomes se (quase) todos os seus códigos
 * existem na tabela de municípios. Um campo de CBO ou de CID, que também são
 * números de seis dígitos, não passa dessa prova e fica como está. UF é mais
 * fraca (dois dígitos colidem com idade e com código de procedimento), então
 * ali o nome do campo também tem que indicar UF.
 *
 * Só mexe no rótulo. A chave continua sendo o código: filtros, mapa,
 * exportação por código e notas técnicas seguem casando por ela. E só troca
 * rótulo que ainda é o código cru — se a CNV do DEF já deu um nome, ele manda.
 */
import type { ResultAxisItem, TabulationResult } from '../../core/src/model.js';
import type { GeographyNames } from './geographic-picker.js';

/** Fração mínima de códigos do eixo que precisa existir na tabela para trocar. */
const MINIMO_RECONHECIDO = 0.9;

function codigoDeMunicipio(chave: string): string | null {
  const limpo = chave.trim();
  return /^\d{6,7}$/.test(limpo) ? limpo.slice(0, 6) : null;
}

function nomearEixo(
  itens: ResultAxisItem[],
  campo: string | undefined,
  nomes: GeographyNames,
): ResultAxisItem[] {
  // Linhas de subtotal, total e "Não classificados" não são lugares: ficam de
  // fora da prova e do rótulo.
  const candidatos = itens.filter((item) => item.source !== 'derived' && item.label.trim() === item.key.trim());
  if (!candidatos.length) return itens;

  const municipios = candidatos.filter((item) => codigoDeMunicipio(item.key));
  const reconhecidosM = municipios.filter((item) => nomes.municipios[codigoDeMunicipio(item.key)!]);
  if (municipios.length === candidatos.length && reconhecidosM.length / candidatos.length >= MINIMO_RECONHECIDO) {
    return itens.map((item) => {
      if (!candidatos.includes(item)) return item;
      const nome = nomes.municipios[codigoDeMunicipio(item.key)!];
      return nome ? { ...item, label: `${nome} (${item.key.trim()})` } : item;
    });
  }

  if (campo && /UF|ESTADO/i.test(campo) && candidatos.every((item) => /^\d{2}$/.test(item.key.trim()) && nomes.ufs[item.key.trim()])) {
    return itens.map((item) => {
      if (!candidatos.includes(item)) return item;
      const uf = nomes.ufs[item.key.trim()]!;
      return { ...item, label: `${uf.nome} (${item.key.trim()})` };
    });
  }
  return itens;
}

export function nameGeographicLabels(
  result: TabulationResult,
  fields: { rows?: string; columns?: string },
  nomes: GeographyNames,
): TabulationResult {
  const rows = nomearEixo(result.rows, fields.rows, nomes);
  const columns = nomearEixo(result.columns, fields.columns, nomes);
  if (rows === result.rows && columns === result.columns) return result;
  return { ...result, rows, columns };
}
