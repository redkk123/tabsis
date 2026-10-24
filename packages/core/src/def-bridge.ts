import type {
  DefConversionOption,
  DefDbfLookupOption,
  DefDefinition,
  DefIncrement,
  DefOption,
} from '../../formats/src/def-model.js';
import type { DataRecord, DimensionLookupDefinition, DimensionSpec, FilterSpec, MeasureSpec } from './model.js';

export class UnsupportedDefFeatureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsupportedDefFeatureError';
  }
}

export function conversionIdForDefOption(option: DefConversionOption): string {
  // File name is intentionally retained rather than case-folded: provenance will
  // later hash the exact artifact. Callers may map this id to a content-addressed id.
  return option.conversionFile;
}

/**
 * Narrows to a conversion option, refusing the others with a message that says
 * what is actually missing.
 *
 * A DBF lookup can serve as a *dimension* - {@link lookupDefinitionFromDefOption}
 * builds its axis - but not yet as a *filter*, because a filter selects by
 * category sequence and a lookup axis has codes, not sequences. An external
 * lookup points at a resource file outside the DEF, so nothing can execute it
 * without that file in hand.
 */
function requireConversion(option: DefOption, use: string): DefConversionOption {
  if (option.kind !== 'conversion') {
    const detail = option.kind === 'dbf-lookup'
      ? `uma tabela DBF (${option.lookupFile})`
      : `um recurso externo (${option.resourceFile})`;
    throw new UnsupportedDefFeatureError(
      `A opção "${option.label}" do DEF usa ${detail}, que ainda não pode ser usada como ${use}.`,
    );
  }
  return option;
}

export function dimensionFromDefOption(option: DefOption): DimensionSpec {
  if (option.kind === 'dbf-lookup') {
    return { field: option.field, lookupId: option.lookupFile };
  }
  const conversion = requireConversion(option, 'dimensão');
  return {
    field: conversion.field,
    conversionId: conversionIdForDefOption(conversion),
    startPosition: conversion.startPosition,
  };
}

/** Builds the exact ordered code -> display-label axis a DEF DBF lookup declares. */
function nomeBase(caminho: string): string {
  return caminho.replace(/\\/g, '/').split('/').pop()?.toUpperCase() ?? caminho.toUpperCase();
}

export function lookupDefinitionFromDefOption(
  option: DefDbfLookupOption,
  records: readonly DataRecord[],
): DimensionLookupDefinition {
  const entries: Array<{ key: string; label: string }> = [];
  const labelsByKey = new Map<string, string>();
  // A chave é o campo do DBF com o mesmo nome do campo dos dados (CNES em
  // TCNESAC.DBF); sem ele, o TabWin usa o PRIMEIRO campo do DBF: no SIA,
  // "PA_CNPJ_CC, FOR_RZSOC, DBF\S_FORNEC.DBF" casa pelo FOR_CNPJ
  // (varredura de 2026-10-24).
  const campos = records[0] ? Object.keys(records[0]) : [];
  // Nomes de campo do DEF valem sem diferença de maiúsculas ("ds_cbo" no DEF do
  // SIA, DS_CBO no CBO.dbf).
  const campo = (nome: string): string => campos.find((candidato) => candidato.toUpperCase() === nome.trim().toUpperCase()) ?? nome;
  const primeiro = campos[0];
  const chave = campos.some((nome) => nome.toUpperCase() === option.field.toUpperCase()) || !primeiro ? campo(option.field) : primeiro;
  const rotulo = campo(option.lookupLabelField);
  // DEF que repete o par rótulo/DBF ("CD_DESCR, DBF\S_CID.DBF, CD_DESCR,
  // DBF\S_CID.DBF"): o TabWin agrupa pelo rótulo e mostra só ele — 14.705
  // códigos da CID viram as 14.257 descrições distintas (varredura de
  // 2026-10-24).
  const [rotulo2, arquivo2] = option.trailingFields ?? [];
  const agrupar = Boolean(rotulo2 && arquivo2 && nomeBase(arquivo2) === nomeBase(option.lookupFile));
  if (agrupar) {
    const grupos = new Map<string, { key: string; label: string; codes: string[] }>();
    const campoGrupo = campo(rotulo2!);
    for (const record of records) {
      const key = String(record[chave] ?? '').trim();
      const name = String(record[campoGrupo] ?? '').trim();
      if (!key || !name) continue;
      const grupo = grupos.get(name) ?? { key: name, label: name, codes: [] };
      grupo.codes.push(key);
      grupos.set(name, grupo);
    }
    if (!grupos.size) throw new Error(`${option.lookupFile}: no usable ${option.field} -> ${rotulo2} lookup rows`);
    return { kind: 'dbf-lookup', entries: [...grupos.values()] };
  }
  for (const record of records) {
    const key = String(record[chave] ?? '').trim();
    const bruto = String(record[rotulo] ?? '');
    // Registro com quebra de linha dentro do nome (TB_GRUPO.DBF do SIA: "09⏎
    // Procedimentos para Ofertas…"): o TabWin não o mostra.
    if (/[\r\n]/.test(bruto)) continue;
    const name = bruto.trim();
    if (!key) continue;
    const label = name ? `${key} ${name}` : key;
    const previous = labelsByKey.get(key);
    if (previous !== undefined) {
      if (previous !== label) throw new Error(`${option.lookupFile}: conflicting labels for lookup key ${key}`);
      continue;
    }
    labelsByKey.set(key, label);
    entries.push({ key, label });
  }
  if (!entries.length) {
    throw new Error(`${option.lookupFile}: no usable ${option.field} -> ${option.lookupLabelField} lookup rows`);
  }
  return { kind: 'dbf-lookup', entries };
}

export function filterFromDefOption(
  option: DefOption,
  acceptedCategorySequences: Array<string | number>,
): FilterSpec {
  const conversion = requireConversion(option, 'filtro');
  return {
    field: conversion.field,
    conversionId: conversionIdForDefOption(conversion),
    startPosition: conversion.startPosition,
    acceptedCategories: acceptedCategorySequences.map(String),
  };
}

export function frequencyMeasureFromDef(definition: DefDefinition): MeasureSpec {
  return {
    kind: 'count',
    ...(definition.groupedCountField ? { weightField: definition.groupedCountField } : {}),
  };
}

export function sumMeasureFromDefIncrement(increment: DefIncrement): MeasureSpec {
  // G003 established that the real engine headers the column with the
  // increment's own label ("Valor Total"), so it travels with the measure.
  const label = increment.label.trim();
  return { kind: 'sum', field: increment.field, ...(label ? { label } : {}) };
}
