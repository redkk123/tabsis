/**
 * The TabWin tabulation panel, as data.
 *
 * TabWin 4.15's "Tabula" form (TTABULA in the executable's DFM resources) is
 * four lists and a few switches: **Linhas**, **Colunas**, **Incremento**,
 * **Seleções disponíveis → Seleções ativas → Categorias selecionadas**,
 * "Suprimir linhas/colunas zeradas" and "Não classificados". Everything in
 * those lists comes from the `.DEF`, in file order. This module rebuilds that
 * panel from a parsed DEF (or, without a DEF, from the file's own fields) and
 * turns a choice on it into the kernel's {@link TabulationSpec}.
 *
 * Behaviour below was observed in the real program under Wine on 2026-10-13
 * (docs/reverse-engineering/RE_002_PAINEL_TABULA.md):
 *
 * - Colunas starts at "Não ativa"; Incremento starts at Frequência, which is
 *   always first, followed by the DEF `I` lines.
 * - "Suprimir colunas zeradas" starts checked; "Suprimir linhas zeradas" does not.
 * - A column together with more than one increment is refused with
 *   "Múltiplas colunas é incompatível com múltiplos incrementos".
 * - An active selection with no category marked is refused with
 *   "Nenhuma categoria selecionada em <selection>".
 * - "Não classificados → Incluir" adds one "Não classificados" row; "Ignorar"
 *   drops those records. "Discriminar" did not change the rows in the observed
 *   case and is not reproduced until a case shows what it does.
 */

import type { CnvDefinition } from '../../formats/src/cnv-model.js';
import type { DefDefinition, DefOption } from '../../formats/src/def-model.js';
import type { TabwinLog } from '../../formats/src/tabwin-log.js';
import type {
  CompatibilityProfile,
  DimensionLookupDefinition,
  DimensionSpec,
  FilterSpec,
  MeasureSpec,
  TabulationSpec,
} from './model.js';

/** One entry in Linhas, Colunas or Seleções disponíveis. */
export interface PainelEixo {
  /** Stable within one catalog: `def:<sourceLine>:<role>` or `campo:<FIELD>`. */
  id: string;
  /** Exactly as the DEF writes it — the name a TabWin user already knows. */
  label: string;
  field: string;
  /** Loaded CNV name, when this entry classifies through one. */
  conversionId?: string;
  /** Loaded DBF lookup name, when this entry labels through one. */
  lookupId?: string;
  startPosition?: number;
  /** Resource file the DEF names (`CNV\br_uf.cnv`), kept verbatim for display. */
  resourceFile?: string;
  /** False when the entry cannot run yet; `motivo` says what is missing. */
  disponivel: boolean;
  motivo?: string;
}

export interface PainelIncremento {
  id: string;
  label: string;
  measure: MeasureSpec;
}

export interface PainelCatalogo {
  origem: 'def' | 'campos';
  /** DEF first comment line — TabWin uses it as the table title. */
  titulo?: string;
  /** DEF `A` pattern (`DADOS\RD*.DBC`), shown beside Arquivos as TabWin does. */
  padraoArquivos?: string;
  linhas: PainelEixo[];
  colunas: PainelEixo[];
  selecoes: PainelEixo[];
  incrementos: PainelIncremento[];
}

export type NaoClassificados = 'ignorar' | 'incluir';

export interface PainelSelecao {
  eixo: string;
  /** CNV sequence numbers as strings, or raw codes for lookup/field entries. */
  categorias: string[];
}

export interface PainelEstado {
  linha: string;
  /** `null` is TabWin's "Não ativa". */
  coluna: string | null;
  incrementos: string[];
  selecoes: PainelSelecao[];
  suprimirLinhasZeradas: boolean;
  suprimirColunasZeradas: boolean;
  naoClassificados: NaoClassificados;
}

/** A refusal phrased like TabWin's own message box. */
export class PainelErro extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PainelErro';
  }
}

export const FREQUENCIA_ID = 'freq';

export interface ResolvedorDeRecursos {
  /** Loaded CNV name for a DEF path like `CNV\br_uf.cnv`, if it was loaded. */
  conversao(arquivo: string): string | undefined;
  /** Loaded DBF lookup name for a DEF path like `DBF\TCNESAC.DBF`, if loaded. */
  lookup(arquivo: string): string | undefined;
}

/** File name only, lower-case: `CNV\br_uf.cnv` and `BR_UF.CNV` are the same table. */
export function nomeBaseDoRecurso(path: string): string {
  return path.replace(/\\/g, '/').split('/').pop()?.toLowerCase() ?? path.toLowerCase();
}

function eixoDoDef(option: DefOption, papel: string, recursos: ResolvedorDeRecursos, campos?: ReadonlySet<string>): PainelEixo {
  const id = `def:${option.sourceLine}:${papel}`;
  const base = { id, label: option.label, field: option.field };
  const faltaCampo = campos && !campos.has(option.field.toUpperCase());
  if (option.kind === 'conversion') {
    const conversionId = recursos.conversao(option.conversionFile);
    const motivo = faltaCampo
      ? `o arquivo aberto não tem o campo ${option.field}`
      : conversionId ? undefined : `falta a tabela ${option.conversionFile}`;
    return {
      ...base,
      startPosition: option.startPosition,
      resourceFile: option.conversionFile,
      ...(conversionId ? { conversionId } : {}),
      disponivel: !motivo,
      ...(motivo ? { motivo } : {}),
    };
  }
  if (option.kind === 'dbf-lookup') {
    const lookupId = recursos.lookup(option.lookupFile);
    const motivo = faltaCampo
      ? `o arquivo aberto não tem o campo ${option.field}`
      : lookupId ? undefined : `falta a tabela ${option.lookupFile}`;
    return {
      ...base,
      resourceFile: option.lookupFile,
      ...(lookupId ? { lookupId } : {}),
      disponivel: !motivo,
      ...(motivo ? { motivo } : {}),
    };
  }
  return {
    ...base,
    resourceFile: option.resourceFile,
    disponivel: false,
    motivo: `usa ${option.resourceFile} de um jeito que o TabSis ainda não executa`,
  };
}

/**
 * Builds the panel lists from a DEF, in file order, exactly as TabWin lists them.
 *
 * `campos` (upper-case DBF field names of the open file) marks entries whose
 * field the file lacks; they stay listed, greyed, because hiding them would
 * make the panel disagree with the DEF a veteran is reading.
 */
export function catalogoDoDef(
  def: DefDefinition,
  recursos: ResolvedorDeRecursos,
  campos?: ReadonlySet<string>,
): PainelCatalogo {
  const linhas: PainelEixo[] = [];
  const colunas: PainelEixo[] = [];
  const selecoes: PainelEixo[] = [];
  for (const option of def.options) {
    if (option.roles.includes('row')) linhas.push(eixoDoDef(option, 'L', recursos, campos));
    if (option.roles.includes('column')) colunas.push(eixoDoDef(option, 'C', recursos, campos));
    if (option.roles.includes('selection')) selecoes.push(eixoDoDef(option, 'S', recursos, campos));
  }
  const frequencia: MeasureSpec = {
    kind: 'count',
    ...(def.groupedCountField ? { weightField: def.groupedCountField } : {}),
  };
  const incrementos: PainelIncremento[] = [
    { id: FREQUENCIA_ID, label: 'Frequência', measure: frequencia },
    ...def.increments.map((increment) => {
      const label = increment.label.trim();
      return {
        id: `inc:${increment.sourceLine}`,
        label,
        measure: { kind: 'sum' as const, field: increment.field, ...(label ? { label } : {}) },
      };
    }),
  ];
  return {
    origem: 'def',
    ...(def.description ? { titulo: def.description } : {}),
    ...(def.dataSources[0]?.pattern ? { padraoArquivos: def.dataSources[0].pattern } : {}),
    linhas,
    colunas,
    selecoes,
    incrementos,
  };
}

export interface CampoDoArquivo {
  name: string;
  /** DBF type letter; N and F fields become summable increments. */
  type?: string;
}

/**
 * Without a DEF, the panel lists the file's own fields — still useful, and it
 * is what TabWin users get when they open a DBF without its definition.
 */
export function catalogoDosCampos(
  campos: readonly CampoDoArquivo[],
  rotulo: (campo: string) => string = (campo) => campo,
): PainelCatalogo {
  const eixos = campos.map((campo) => ({
    id: `campo:${campo.name.toUpperCase()}`,
    label: rotulo(campo.name),
    field: campo.name,
    disponivel: true,
  }));
  const incrementos: PainelIncremento[] = [
    { id: FREQUENCIA_ID, label: 'Frequência', measure: { kind: 'count' } },
    ...campos
      .filter((campo) => campo.type === 'N' || campo.type === 'F')
      .map((campo) => ({
        id: `soma:${campo.name.toUpperCase()}`,
        label: rotulo(campo.name),
        measure: { kind: 'sum' as const, field: campo.name },
      })),
  ];
  return { origem: 'campos', linhas: eixos, colunas: eixos, selecoes: eixos, incrementos };
}

/** TabWin's defaults when the panel opens. */
export function estadoInicial(catalogo: PainelCatalogo): PainelEstado {
  const linha = catalogo.linhas.find((eixo) => eixo.disponivel) ?? catalogo.linhas[0];
  return {
    linha: linha?.id ?? '',
    coluna: null,
    incrementos: [FREQUENCIA_ID],
    selecoes: [],
    suprimirLinhasZeradas: false,
    suprimirColunasZeradas: true,
    naoClassificados: 'ignorar',
  };
}

function exigirEixo(lista: readonly PainelEixo[], id: string, papel: string): PainelEixo {
  const eixo = lista.find((candidate) => candidate.id === id);
  if (!eixo) throw new PainelErro(`Escolha ${papel}.`);
  if (!eixo.disponivel) throw new PainelErro(`${eixo.label}: ${eixo.motivo ?? 'indisponível'}.`);
  return eixo;
}

function dimensao(eixo: PainelEixo, naoClassificados: NaoClassificados): DimensionSpec {
  return {
    field: eixo.field,
    ...(eixo.conversionId ? { conversionId: eixo.conversionId, startPosition: eixo.startPosition ?? 1 } : {}),
    ...(eixo.lookupId ? { lookupId: eixo.lookupId } : {}),
    ...(naoClassificados === 'incluir' && (eixo.conversionId || eixo.lookupId)
      ? { unclassifiedPolicy: 'discriminate' as const } : {}),
  };
}

function filtro(eixo: PainelEixo, categorias: readonly string[]): FilterSpec {
  // A lookup or a bare field selects by raw code; only a CNV selects by sequence.
  return {
    field: eixo.field,
    ...(eixo.conversionId ? { conversionId: eixo.conversionId, startPosition: eixo.startPosition ?? 1 } : {}),
    acceptedCategories: [...categorias],
  };
}

/** Translates the panel into the kernel spec, refusing what TabWin refuses. */
export function specDoPainel(
  catalogo: PainelCatalogo,
  estado: PainelEstado,
  perfil: CompatibilityProfile = 'tabwin-4.15',
): TabulationSpec {
  const linha = exigirEixo(catalogo.linhas, estado.linha, 'uma variável de Linhas');
  const coluna = estado.coluna ? exigirEixo(catalogo.colunas, estado.coluna, 'uma variável de Colunas') : null;
  const incrementos = catalogo.incrementos.filter((incremento) => estado.incrementos.includes(incremento.id));
  if (!incrementos.length) throw new PainelErro('Escolha ao menos um Incremento.');
  if (coluna && incrementos.length > 1) {
    throw new PainelErro('Múltiplas colunas é incompatível com múltiplos incrementos');
  }
  const filters: FilterSpec[] = [];
  for (const selecao of estado.selecoes) {
    const eixo = exigirEixo(catalogo.selecoes, selecao.eixo, 'uma seleção');
    if (!selecao.categorias.length) throw new PainelErro(`Nenhuma categoria selecionada em ${eixo.label}`);
    filters.push(filtro(eixo, selecao.categorias));
  }
  const [primeira] = incrementos;
  return {
    compatibilityProfile: perfil,
    rows: dimensao(linha, estado.naoClassificados),
    ...(coluna ? { columns: dimensao(coluna, estado.naoClassificados) } : {}),
    measure: primeira!.measure,
    ...(incrementos.length > 1 ? { measures: incrementos.map((incremento) => incremento.measure) } : {}),
    filters,
    suppressZeroRows: estado.suprimirLinhasZeradas,
    suppressZeroColumns: estado.suprimirColunasZeradas,
  };
}

function rotuloDoIncremento(incremento: PainelIncremento, perfil: CompatibilityProfile): string {
  if (incremento.id === FREQUENCIA_ID && perfil === 'tabwin-4.15') return 'Freqüência';
  return incremento.label;
}

/**
 * TabWin's subtitle: "Freqüência por Caráter segundo Sexo", or with several
 * increments "Freqüência Valor Total Óbitos segundo Hospital AC (CNES)" (G017).
 */
export function subtituloDoPainel(
  catalogo: PainelCatalogo,
  estado: PainelEstado,
  perfil: CompatibilityProfile = 'tabwin-4.15',
): string {
  const incrementos = catalogo.incrementos
    .filter((incremento) => estado.incrementos.includes(incremento.id))
    .map((incremento) => rotuloDoIncremento(incremento, perfil));
  const linha = catalogo.linhas.find((eixo) => eixo.id === estado.linha)?.label ?? '';
  const coluna = estado.coluna ? catalogo.colunas.find((eixo) => eixo.id === estado.coluna)?.label : undefined;
  return `${incrementos.join(' ')}${coluna ? ` por ${coluna}` : ''} segundo ${linha}`;
}

/** Category list for one selection entry, in the order TabWin shows it. */
export function categoriasDoEixo(
  eixo: PainelEixo,
  conversoes: ReadonlyMap<string, CnvDefinition>,
  lookups: ReadonlyMap<string, DimensionLookupDefinition>,
): Array<{ id: string; label: string }> | null {
  if (eixo.conversionId) {
    const cnv = conversoes.get(eixo.conversionId);
    if (!cnv) return null;
    return [...cnv.categories]
      .sort((a, b) => a.sequence - b.sequence)
      .map((category) => ({ id: String(category.sequence), label: category.label }));
  }
  if (eixo.lookupId) {
    const lookup = lookups.get(eixo.lookupId);
    return lookup ? lookup.entries.map((entry) => ({ id: entry.key, label: entry.label })) : null;
  }
  // A bare field has no fixed list; the caller asks the data for its values.
  return null;
}

export interface MetadadosDoLog {
  def?: string;
  padrao?: string;
  arquivos: string[];
  registros?: number;
  tempo?: string;
}

/** The TabWin log for this panel state, ready for {@link serializeTabwinLog}. */
export function logDoPainel(
  catalogo: PainelCatalogo,
  estado: PainelEstado,
  meta: MetadadosDoLog,
  rotuloDaCategoria: (eixo: PainelEixo, categoria: string) => string,
  perfil: CompatibilityProfile = 'tabwin-4.15',
): TabwinLog {
  const linha = catalogo.linhas.find((eixo) => eixo.id === estado.linha);
  const coluna = estado.coluna ? catalogo.colunas.find((eixo) => eixo.id === estado.coluna) : undefined;
  return {
    ...(meta.def !== undefined ? { def: meta.def } : {}),
    ...(meta.padrao !== undefined ? { path: meta.padrao } : {}),
    ...(linha ? { row: linha.label } : {}),
    ...(coluna ? { column: coluna.label } : {}),
    increments: catalogo.incrementos
      .filter((incremento) => estado.incrementos.includes(incremento.id))
      .map((incremento) => rotuloDoIncremento(incremento, perfil)),
    suppressZeroRows: estado.suprimirLinhasZeradas,
    suppressZeroColumns: estado.suprimirColunasZeradas,
    unclassified: estado.naoClassificados === 'incluir' ? 1 : 0,
    selections: estado.selecoes.flatMap((selecao) => {
      const eixo = catalogo.selecoes.find((candidate) => candidate.id === selecao.eixo);
      return eixo ? [{ label: eixo.label, categories: selecao.categorias.map((id) => rotuloDaCategoria(eixo, id)) }] : [];
    }),
    files: [...meta.arquivos],
    ...(meta.registros !== undefined ? { recordsProcessed: meta.registros } : {}),
    ...(meta.tempo !== undefined ? { elapsed: meta.tempo } : {}),
  };
}

function semAcento(texto: string): string {
  return texto.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
}

/**
 * "Restaurar consulta": rebuilds a panel state from a TabWin log or `.TAB`.
 *
 * Names are matched by label, the only thing the log carries. Anything that
 * does not match is reported, never guessed — a log from another DEF should
 * say so instead of silently tabulating something else.
 */
export function estadoDoLog(
  catalogo: PainelCatalogo,
  log: TabwinLog,
  categoriasDe: (eixo: PainelEixo) => Array<{ id: string; label: string }> | null,
): { estado: PainelEstado; avisos: string[] } {
  const avisos: string[] = [];
  const estado = estadoInicial(catalogo);
  const acha = (lista: readonly PainelEixo[], rotulo: string | undefined) =>
    rotulo === undefined ? undefined : lista.find((eixo) => semAcento(eixo.label) === semAcento(rotulo));

  if (log.row !== undefined) {
    const linha = acha(catalogo.linhas, log.row);
    if (linha) estado.linha = linha.id;
    else avisos.push(`Linha "${log.row}" não existe neste DEF.`);
  }
  if (log.column) {
    const coluna = acha(catalogo.colunas, log.column);
    if (coluna) estado.coluna = coluna.id;
    else avisos.push(`Coluna "${log.column}" não existe neste DEF.`);
  }
  if (log.increments.length) {
    const ids: string[] = [];
    for (const rotulo of log.increments) {
      const incremento = catalogo.incrementos.find((candidate) =>
        semAcento(candidate.label) === semAcento(rotulo)
        || (candidate.id === FREQUENCIA_ID && semAcento(rotulo) === 'frequencia'));
      if (incremento) ids.push(incremento.id);
      else avisos.push(`Incremento "${rotulo}" não existe neste DEF.`);
    }
    if (ids.length) estado.incrementos = ids;
  }
  if (log.suppressZeroRows !== undefined) estado.suprimirLinhasZeradas = log.suppressZeroRows;
  if (log.suppressZeroColumns !== undefined) estado.suprimirColunasZeradas = log.suppressZeroColumns;
  if (log.unclassified === 1) estado.naoClassificados = 'incluir';
  if (log.unclassified === 2) avisos.push('"Não classificados: Discriminar" ainda não é reproduzido; usado "Ignorar".');

  for (const selecao of log.selections) {
    const eixo = acha(catalogo.selecoes, selecao.label);
    if (!eixo) {
      avisos.push(`Seleção "${selecao.label}" não existe neste DEF.`);
      continue;
    }
    const lista = categoriasDe(eixo) ?? [];
    const categorias: string[] = [];
    for (const rotulo of selecao.categories) {
      const categoria = lista.find((candidate) => semAcento(candidate.label) === semAcento(rotulo))
        ?? lista.find((candidate) => candidate.id === rotulo);
      if (categoria) categorias.push(categoria.id);
      else avisos.push(`Categoria "${rotulo}" não existe em ${eixo.label}.`);
    }
    if (categorias.length) estado.selecoes.push({ eixo: eixo.id, categorias });
  }
  return { estado, avisos };
}
