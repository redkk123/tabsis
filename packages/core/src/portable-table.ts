import type { QueryPlan, ResultAxisItem, SourceFingerprint, TableOperation, TabulationResult, TechnicalNote } from './model.js';
import { validateTechnicalNotes } from './model.js';
import { compileQueryPlan } from './plan.js';
import { stableJson, validateTableOperation } from './recipe.js';

export interface PortableTableV1 {
  schema: 'tabwin-web.table';
  version: 1;
  title: string;
  rowLabel: string;
  createdAt: string;
  source?: Pick<SourceFingerprint, 'name' | 'sha256' | 'size'>;
  plan: QueryPlan;
  baseResult: TabulationResult;
  operations: TableOperation[];
  presentation?: {
    sortColumnKey: string;
    sortDirection: 'original' | 'ascending' | 'descending';
    decimalPlaces: number;
    keyVisible: boolean;
    subtitle?: string;
    footer?: string;
    notes?: TechnicalNote[];
  };
}

function validateAxis(value: unknown, name: string): asserts value is ResultAxisItem[] {
  if (!Array.isArray(value)) throw new Error(`invalid ${name} axis in TabSis table`);
  const keys = new Set<string>();
  for (const item of value) {
    if (!item || typeof item !== 'object') throw new Error(`invalid ${name} item in TabSis table`);
    const axis = item as Partial<ResultAxisItem>;
    if (typeof axis.key !== 'string' || !axis.key || typeof axis.label !== 'string'
      || !new Set(['raw', 'conversion', 'derived']).has(String(axis.source))) {
      throw new Error(`invalid ${name} item in TabSis table`);
    }
    if ((axis.subtotalTargetKey !== undefined && typeof axis.subtotalTargetKey !== 'string')
      || (axis.excludeFromTotal !== undefined && typeof axis.excludeFromTotal !== 'boolean')
      || (axis.precalculatedTotal !== undefined && (typeof axis.precalculatedTotal !== 'number' || !Number.isFinite(axis.precalculatedTotal)))
      || (axis.directTotal !== undefined && (!Array.isArray(axis.directTotal) || axis.directTotal.some((value) => typeof value !== 'number' || !Number.isFinite(value))))
      || (axis.decimals !== undefined && (typeof axis.decimals !== 'number' || !Number.isInteger(axis.decimals) || axis.decimals < 0 || axis.decimals > 10))
      || (axis.totalPolicy !== undefined && !new Set([
        'none', 'sum', 'product', 'mean', 'initial', 'final', 'min', 'max', 'precalculated',
      ]).has(axis.totalPolicy))) {
      throw new Error(`invalid ${name} metadata in TabSis table`);
    }
    if (keys.has(axis.key)) throw new Error(`duplicate ${name} key in TabSis table: ${axis.key}`);
    keys.add(axis.key);
  }
}

function validateResult(value: unknown): asserts value is TabulationResult {
  if (!value || typeof value !== 'object') throw new Error('invalid result in TabSis table');
  const result = value as Partial<TabulationResult>;
  validateAxis(result.rows, 'row');
  validateAxis(result.columns, 'column');
  if (!Array.isArray(result.cells) || result.cells.length !== result.rows.length) {
    throw new Error('result row/cell shape mismatch in TabSis table');
  }
  for (const row of result.cells) {
    if (!Array.isArray(row) || row.length !== result.columns.length || row.some((cell) => typeof cell !== 'number' || !Number.isFinite(cell))) {
      throw new Error('invalid or non-finite result cell in TabSis table');
    }
  }
  if (!Array.isArray(result.warnings) || result.warnings.some((warning) => typeof warning !== 'string')) {
    throw new Error('invalid result warnings in TabSis table');
  }
  for (const count of [result.recordsSeen, result.recordsAccepted]) {
    if (!Number.isInteger(count) || Number(count) < 0) throw new Error('invalid record count in TabSis table');
  }
  if (Number(result.recordsAccepted) > Number(result.recordsSeen)) {
    throw new Error('accepted record count exceeds seen records in TabSis table');
  }
}

export function serializePortableTable(table: PortableTableV1): string {
  return stableJson(table);
}

export function parsePortableTable(json: string): PortableTableV1 {
  const value = JSON.parse(json) as Partial<PortableTableV1>;
  if (value.schema !== 'tabwin-web.table' || value.version !== 1
    || typeof value.title !== 'string' || !value.title.trim()
    || typeof value.rowLabel !== 'string' || !value.rowLabel.trim()
    || typeof value.createdAt !== 'string' || !Number.isFinite(Date.parse(value.createdAt))
    || !value.plan || value.plan.version !== 1) {
    throw new Error('unsupported or invalid TabSis table');
  }
  compileQueryPlan(value.plan.spec);
  if (!Array.isArray(value.plan.warnings) || value.plan.warnings.some((warning) => typeof warning !== 'string')) {
    throw new Error('invalid QueryPlan warnings in TabSis table');
  }
  validateResult(value.baseResult);
  if (!Array.isArray(value.operations)) throw new Error('invalid operations in TabSis table');
  for (const operation of value.operations) validateTableOperation(operation);
  if (value.source !== undefined && (!value.source || typeof value.source.name !== 'string'
    || typeof value.source.sha256 !== 'string' || typeof value.source.size !== 'number'
    || !Number.isFinite(value.source.size) || value.source.size < 0)) {
    throw new Error('invalid source fingerprint in TabSis table');
  }
  if (value.presentation !== undefined) {
    const presentation = value.presentation;
    if (typeof presentation.sortColumnKey !== 'string'
      || !new Set(['original', 'ascending', 'descending']).has(presentation.sortDirection)
      || !Number.isInteger(presentation.decimalPlaces) || presentation.decimalPlaces < -1 || presentation.decimalPlaces > 6
      || typeof presentation.keyVisible !== 'boolean'
      || (presentation.subtitle !== undefined && (typeof presentation.subtitle !== 'string' || presentation.subtitle.length > 240))
      || (presentation.footer !== undefined && (typeof presentation.footer !== 'string' || presentation.footer.length > 240))) {
      throw new Error('invalid presentation in TabSis table');
    }
    if (presentation.notes !== undefined) {
      validateTechnicalNotes(presentation.notes, 'TabSis table');
    }
  }
  return value as PortableTableV1;
}
