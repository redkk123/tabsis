/**
 * Editor de CNV: cria, edita e valida tabelas de conversão sobre o modelo
 * `CnvDefinition`, nunca sobre o texto cru.
 *
 * Separado do main.ts (2026-10-14). Conversa com o resto do aplicativo só
 * pelas funções de {@link EditorCnvDeps}.
 */

import {
  classifyCnv,
  encodeWindows1252,
  generateCnvFromValues,
  serializeCnv,
  validateCnvDefinition,
  type CnvCategory,
  type CnvCodeRange,
  type CnvDefinition,
  type CnvDiagnostic,
  type CnvRuleLine,
} from '../../../packages/formats/src/index.ts';

export interface EditorCnvDeps {
  conversoes(): Map<string, CnvDefinition>;
  /** Campos do arquivo aberto, ou `null` sem arquivo. */
  campos(): string[] | null;
  rotuloDoCampo(campo: string): string;
  valoresDistintos(campo: string, limite: number): Promise<{ values: string[]; truncated: boolean }>;
  /** Guarda a CNV com este nome e refaz o que depende dela. */
  aplicar(nome: string, definicao: CnvDefinition): void;
  aviso(mensagem: string, erro?: boolean): void;
  baixar(blob: Blob, nome: string): void;
}

export interface EditorCnv {
  abrir(nome?: string): void;
}

function element<T extends Element>(selector: string): T {
  const found = document.querySelector<T>(selector);
  if (!found) throw new Error(`Elemento ausente: ${selector}`);
  return found;
}

const integerFormat = new Intl.NumberFormat('pt-BR');

interface CnvEditorRow {
  sequence: number;
  label: string;
  /** '', '#' (exclude from total), or a category sequence as a string. */
  subtotal: string;
  /** Comma-separated codes/ranges ("01,10-20"), or a single number in numeric-ranges mode. */
  codesText: string;
}



export function criarEditorCnv(deps: EditorCnvDeps): EditorCnv {
const showToast = deps.aviso;
const cnvEditorDialog = element<HTMLDialogElement>('#cnv-editor-dialog');
const cnvEditorClose = element<HTMLButtonElement>('#cnv-editor-close');
const cnvEditorSource = element<HTMLSelectElement>('#cnv-editor-source');
const cnvEditorNew = element<HTMLButtonElement>('#cnv-editor-new');
const cnvEditorFilename = element<HTMLInputElement>('#cnv-editor-filename');
const cnvEditorModeSelect = element<HTMLSelectElement>('#cnv-editor-mode');
const cnvEditorCodeLengthInput = element<HTMLInputElement>('#cnv-editor-code-length');
const cnvEditorCodesHeader = element<HTMLElement>('#cnv-editor-codes-header');
const cnvEditorRowsBody = element<HTMLElement>('#cnv-editor-rows');
const cnvEditorAddCategory = element<HTMLButtonElement>('#cnv-editor-add-category');
const cnvEditorDiagnosticsOutput = element<HTMLElement>('#cnv-editor-diagnostics');
const cnvEditorPreviewField = element<HTMLSelectElement>('#cnv-editor-preview-field');
const cnvEditorPreviewButton = element<HTMLButtonElement>('#cnv-editor-preview-button');
const cnvEditorPreviewResult = element<HTMLElement>('#cnv-editor-preview-result');
const cnvEditorDownload = element<HTMLButtonElement>('#cnv-editor-download');
const cnvEditorApply = element<HTMLButtonElement>('#cnv-editor-apply');
const cnvEditorRenumber = element<HTMLButtonElement>('#cnv-editor-renumber');
const cnvEditorGenerate = element<HTMLButtonElement>('#cnv-editor-generate');

/** Editor state, independent of any loaded CnvDefinition until "Aplicar" or "Baixar". */
let cnvEditorRows: CnvEditorRow[] = [];
let cnvEditorMode: CnvDefinition['mode'] = 'short';
let cnvEditorCodeLength = 2;
let cnvEditorReadOnly = false;

/**
 * CNV editor (Faixa 3.2). Works entirely on the {@link CnvDefinition} model
 * — never on raw text — via a small, explicit editable-row shape
 * (`CnvEditorRow`) that round-trips through `parseCodesText`/`codesTextOf`
 * using the exact same token grammar `cnv-parser.ts` reads (comma-separated
 * codes, `from-to` for a range). `cnvEditorDefinition()` rebuilds a full
 * `CnvDefinition` from that state on demand, so diagnostics, the
 * classification preview, "Aplicar" and "Baixar" all read one live model
 * with nothing to keep in sync.
 */
function codesTextOf(rule: CnvRuleLine | undefined, mode: CnvDefinition['mode']): string {
  if (!rule) return '';
  if (mode === 'numeric-ranges') return rule.numericUpperInclusive !== undefined ? String(rule.numericUpperInclusive) : '';
  return [...rule.exactCodes, ...rule.ranges.map((range) => `${range.from}-${range.to}`)].join(',');
}

function subtotalTextOf(category: CnvCategory): string {
  if (category.excludeFromTotal) return '#';
  if (category.subtotalTarget !== undefined) return String(category.subtotalTarget);
  return '';
}

function parseCodesText(
  text: string,
  mode: CnvDefinition['mode'],
): { exactCodes: string[]; ranges: CnvCodeRange[]; numericUpperInclusive?: number } {
  const trimmed = text.trim();
  if (mode === 'numeric-ranges') {
    const value = Number(trimmed);
    return { exactCodes: [], ranges: [], ...(Number.isFinite(value) ? { numericUpperInclusive: value } : {}) };
  }
  const exactCodes: string[] = [];
  const ranges: CnvCodeRange[] = [];
  // Código "em branco" (espaços antes da vírgula), como o leitor de CNV entende.
  if (mode === 'short' && /^ +,/.test(text)) exactCodes.push(' ');
  for (const rawToken of trimmed.split(',')) {
    const token = rawToken.trim();
    if (!token) continue;
    const hyphen = token.indexOf('-');
    if (hyphen > 0 && hyphen < token.length - 1) {
      ranges.push({ from: token.slice(0, hyphen).trim(), to: token.slice(hyphen + 1).trim() });
    } else {
      exactCodes.push(token);
    }
  }
  return { exactCodes, ranges };
}

function rowsFromDefinition(definition: CnvDefinition): CnvEditorRow[] {
  // Row order here becomes rule precedence order again in cnvEditorDefinition()
  // (source order = array index) — it must be the file's real rule order, never
  // definition.categories, which cnv-parser.ts sorts by sequence number for
  // display. A broad fallback declared *before* its specific overrides (the
  // common real layout: 00-99 first, 01/02/03 after) would silently become the
  // rule that always wins if categories' sequence order were used instead.
  const categoryBySequence = new Map(definition.categories.map((category) => [category.sequence, category]));
  const orderedRules = [...definition.rules].sort((a, b) => a.sourceOrder - b.sourceOrder);
  return orderedRules.map((rule) => {
    const category = categoryBySequence.get(rule.categorySequence);
    return {
      sequence: rule.categorySequence,
      label: category?.label ?? '',
      subtotal: category ? subtotalTextOf(category) : '',
      codesText: codesTextOf(rule, definition.mode),
    };
  });
}

function cnvEditorDefinition(): CnvDefinition {
  const categories: CnvCategory[] = cnvEditorRows.map((row) => {
    const subtotal = row.subtotal.trim();
    const subtotalTarget = subtotal && subtotal !== '#' ? Number(subtotal) : undefined;
    return {
      sequence: row.sequence,
      label: row.label,
      ...(subtotal === '#' ? { excludeFromTotal: true } : {}),
      ...(subtotalTarget !== undefined && Number.isFinite(subtotalTarget) ? { subtotalTarget } : {}),
    };
  });
  const rules: CnvRuleLine[] = cnvEditorRows.map((row, index) => {
    const parsed = parseCodesText(row.codesText, cnvEditorMode);
    return {
      categorySequence: row.sequence,
      exactCodes: parsed.exactCodes,
      ranges: parsed.ranges,
      ...(parsed.numericUpperInclusive !== undefined ? { numericUpperInclusive: parsed.numericUpperInclusive } : {}),
      sourceOrder: index,
      sourceLine: index + 2,
    };
  });
  return {
    categoryCount: categories.length,
    codeLength: Number.isFinite(cnvEditorCodeLength) && cnvEditorCodeLength > 0 ? cnvEditorCodeLength : 1,
    mode: cnvEditorMode,
    precedence: cnvEditorMode === 'literal' ? 'first-match-wins' : 'last-match-wins',
    categories,
    rules,
    comments: [],
    warnings: [],
    headerLine: 1,
  };
}

function renderCnvEditorDiagnostics(): CnvDiagnostic[] {
  const diagnostics = validateCnvDefinition(cnvEditorDefinition());
  const bySequence = new Map<number, CnvDiagnostic[]>();
  const headerDiagnostics: CnvDiagnostic[] = [];
  for (const diagnostic of diagnostics) {
    if (diagnostic.scope === 'header' || diagnostic.categorySequence === undefined) {
      headerDiagnostics.push(diagnostic);
      continue;
    }
    const list = bySequence.get(diagnostic.categorySequence) ?? [];
    list.push(diagnostic);
    bySequence.set(diagnostic.categorySequence, list);
  }
  cnvEditorDiagnosticsOutput.replaceChildren(
    ...headerDiagnostics.map((diagnostic) => {
      const line = document.createElement('div');
      line.className = `cnv-editor-diagnostic ${diagnostic.severity}`;
      line.textContent = diagnostic.message;
      return line;
    }),
  );
  for (const rowElement of [...cnvEditorRowsBody.children] as HTMLElement[]) {
    const sequence = Number(rowElement.dataset.sequence);
    const rowDiagnostics = bySequence.get(sequence) ?? [];
    rowElement.classList.toggle('cnv-editor-row-invalid', rowDiagnostics.some((d) => d.severity === 'error'));
    rowElement.title = rowDiagnostics.map((d) => d.message).join(' · ');
  }
  return diagnostics;
}

function renderCnvEditorRow(row: CnvEditorRow, index: number): HTMLElement {
  const tr = document.createElement('tr');
  tr.dataset.sequence = String(row.sequence);

  const sequenceInput = document.createElement('input');
  sequenceInput.type = 'number';
  sequenceInput.className = 'cnv-editor-sequence';
  sequenceInput.value = String(row.sequence);
  sequenceInput.addEventListener('input', () => {
    const value = Number(sequenceInput.value);
    if (Number.isFinite(value)) row.sequence = value;
    tr.dataset.sequence = String(row.sequence);
    renderCnvEditorDiagnostics();
  });

  const labelInput = document.createElement('input');
  labelInput.type = 'text';
  labelInput.value = row.label;
  labelInput.addEventListener('input', () => { row.label = labelInput.value; renderCnvEditorDiagnostics(); });

  const subtotalInput = document.createElement('input');
  subtotalInput.type = 'text';
  subtotalInput.className = 'cnv-editor-subtotal';
  subtotalInput.placeholder = '# ou nº';
  subtotalInput.value = row.subtotal;
  subtotalInput.addEventListener('input', () => { row.subtotal = subtotalInput.value; renderCnvEditorDiagnostics(); });

  const codesInput = document.createElement('input');
  codesInput.type = 'text';
  codesInput.placeholder = cnvEditorMode === 'numeric-ranges' ? 'limite superior' : '01,10-20';
  codesInput.value = row.codesText;
  codesInput.addEventListener('input', () => { row.codesText = codesInput.value; renderCnvEditorDiagnostics(); });

  const removeCell = document.createElement('td');
  removeCell.className = 'cnv-editor-row-remove';
  const removeButton = document.createElement('button');
  removeButton.type = 'button';
  removeButton.className = 'secondary-button';
  removeButton.textContent = '×';
  removeButton.title = 'Remover categoria';
  removeButton.addEventListener('click', () => {
    cnvEditorRows.splice(index, 1);
    renderCnvEditorTable();
  });
  removeCell.append(removeButton);

  for (const input of [sequenceInput, labelInput, subtotalInput, codesInput]) input.disabled = cnvEditorReadOnly;
  removeButton.disabled = cnvEditorReadOnly;

  for (const input of [sequenceInput, labelInput, subtotalInput, codesInput]) {
    const td = document.createElement('td');
    td.append(input);
    tr.append(td);
  }
  tr.append(removeCell);
  return tr;
}

function renderCnvEditorTable(): void {
  const codesLabel = cnvEditorMode === 'numeric-ranges' ? 'Limite superior' : 'Códigos / faixas';
  cnvEditorCodesHeader.textContent = cnvEditorReadOnly ? `${codesLabel} (somente leitura)` : codesLabel;
  cnvEditorRowsBody.replaceChildren(...cnvEditorRows.map((row, index) => renderCnvEditorRow(row, index)));
  renderCnvEditorDiagnostics();
}

function setCnvEditorReadOnly(readOnly: boolean): void {
  cnvEditorReadOnly = readOnly;
  cnvEditorFilename.disabled = readOnly;
  cnvEditorModeSelect.disabled = readOnly;
  cnvEditorCodeLengthInput.disabled = readOnly;
  cnvEditorAddCategory.disabled = readOnly;
  cnvEditorApply.disabled = readOnly;
  cnvEditorDownload.disabled = readOnly;
}

function resetCnvEditorToBlank(): void {
  setCnvEditorReadOnly(false);
  cnvEditorRows = [{ sequence: 1, label: '', subtotal: '', codesText: '' }];
  cnvEditorMode = 'short';
  cnvEditorCodeLength = 2;
  cnvEditorFilename.value = '';
  cnvEditorModeSelect.value = cnvEditorMode;
  cnvEditorCodeLengthInput.value = String(cnvEditorCodeLength);
  renderCnvEditorTable();
}

function loadCnvIntoEditor(name: string): void {
  const definition = deps.conversoes().get(name);
  if (!definition) return;
  setCnvEditorReadOnly(definition.mode === 'new-format');
  cnvEditorRows = rowsFromDefinition(definition);
  cnvEditorMode = definition.mode;
  cnvEditorCodeLength = definition.codeLength;
  cnvEditorFilename.value = name;
  cnvEditorModeSelect.value = cnvEditorMode;
  cnvEditorCodeLengthInput.value = String(cnvEditorCodeLength);
  if (definition.mode === 'new-format') {
    showToast(`${name}: formato N é executável, mas o editor não regrava esse layout — use como somente leitura`, true);
  }
  renderCnvEditorTable();
}

function populateCnvEditorSourceList(): void {
  const previous = cnvEditorSource.value;
  cnvEditorSource.replaceChildren(new Option('Nova CNV…', ''));
  for (const name of [...deps.conversoes().keys()].sort((a, b) => a.localeCompare(b))) {
    cnvEditorSource.add(new Option(name, name));
  }
  cnvEditorSource.value = deps.conversoes().has(previous) ? previous : '';
}

function populateCnvEditorPreviewField(): void {
  cnvEditorPreviewField.replaceChildren();
  if (!deps.campos()) {
    cnvEditorPreviewField.add(new Option('Abra um conjunto de dados para pré-visualizar', ''));
    cnvEditorPreviewField.disabled = true;
    cnvEditorPreviewButton.disabled = true;
    cnvEditorGenerate.disabled = true;
    return;
  }
  cnvEditorPreviewField.disabled = false;
  cnvEditorPreviewButton.disabled = false;
  cnvEditorGenerate.disabled = false;
  for (const field of deps.campos() ?? []) cnvEditorPreviewField.add(new Option(deps.rotuloDoCampo(field), field));
}

async function updateCnvEditorPreview(): Promise<void> {
  const field = cnvEditorPreviewField.value;
  if (!field) return;
  cnvEditorPreviewResult.textContent = 'Lendo os valores do campo…';
  try {
    const definition = cnvEditorDefinition();
    const { values, truncated } = await deps.valoresDistintos(field, 500);
    const counts = new Map<string, number>();
    let unclassified = 0;
    for (const value of values) {
      const match = classifyCnv(definition, value);
      if (!match) { unclassified++; continue; }
      counts.set(match.label, (counts.get(match.label) ?? 0) + 1);
    }
    const table = document.createElement('table');
    const thead = document.createElement('thead');
    thead.innerHTML = '<tr><th>Categoria</th><th>Valores distintos</th></tr>';
    const tbody = document.createElement('tbody');
    for (const category of definition.categories) {
      const row = document.createElement('tr');
      const labelCell = document.createElement('td');
      labelCell.textContent = category.label || `(sequência ${category.sequence})`;
      const countCell = document.createElement('td');
      countCell.textContent = integerFormat.format(counts.get(category.label) ?? 0);
      row.append(labelCell, countCell);
      tbody.append(row);
    }
    const unclassifiedRow = document.createElement('tr');
    const unclassifiedLabel = document.createElement('td');
    unclassifiedLabel.textContent = 'Não classificado';
    const unclassifiedCount = document.createElement('td');
    unclassifiedCount.textContent = integerFormat.format(unclassified);
    unclassifiedRow.append(unclassifiedLabel, unclassifiedCount);
    tbody.append(unclassifiedRow);
    table.append(thead, tbody);
    const note = document.createElement('p');
    note.className = 'dialog-note';
    note.textContent = `${integerFormat.format(values.length)}${truncated ? '+' : ''} valor(es) distinto(s) de "${field}" — contagem de valores distintos, não de registros.`;
    cnvEditorPreviewResult.replaceChildren(note, table);
  } catch (error) {
    cnvEditorPreviewResult.textContent = error instanceof Error ? error.message : String(error);
  }
}

function openCnvEditor(name?: string): void {
  populateCnvEditorSourceList();
  populateCnvEditorPreviewField();
  cnvEditorPreviewResult.replaceChildren();
  if (name && deps.conversoes().has(name)) {
    cnvEditorSource.value = name;
    loadCnvIntoEditor(name);
  } else {
    cnvEditorSource.value = '';
    resetCnvEditorToBlank();
  }
  cnvEditorDialog.showModal();
}

function requireCnvEditorFilename(): string {
  const raw = cnvEditorFilename.value.trim() || 'nova.cnv';
  return /\.cnv$/i.test(raw) ? raw : `${raw}.cnv`;
}

function applyCnvEditor(): void {
  if (cnvEditorReadOnly) {
    showToast('Formato N pode ser usado na tabulação, mas o editor não regrava esse layout', true);
    return;
  }
  const diagnostics = renderCnvEditorDiagnostics();
  if (diagnostics.some((d) => d.severity === 'error')) {
    showToast('Corrija os erros listados antes de aplicar', true);
    return;
  }
  const name = requireCnvEditorFilename();
  deps.aplicar(name, cnvEditorDefinition());
  showToast(`${name}: aplicado ao conjunto atual (${cnvEditorRows.length} categorias)`);
}

function downloadCnvEditorFile(): void {
  if (cnvEditorReadOnly) {
    showToast('Formato N não pode ser regravado: só a leitura do layout está provada, não a escrita', true);
    return;
  }
  const diagnostics = renderCnvEditorDiagnostics();
  if (diagnostics.some((d) => d.severity === 'error')) {
    showToast('Corrija os erros listados antes de baixar', true);
    return;
  }
  try {
    const text = serializeCnv(cnvEditorDefinition());
    const bytes = encodeWindows1252(text);
    deps.baixar(new Blob([bytes], { type: 'text/plain' }), requireCnvEditorFilename());
  } catch (error) {
    showToast(error instanceof Error ? error.message : String(error), true);
  }
}

cnvEditorClose.addEventListener('click', () => cnvEditorDialog.close());
cnvEditorDialog.addEventListener('click', (event) => {
  if (event.target === cnvEditorDialog) cnvEditorDialog.close();
});
cnvEditorSource.addEventListener('change', () => {
  if (cnvEditorSource.value) loadCnvIntoEditor(cnvEditorSource.value);
  else resetCnvEditorToBlank();
});
cnvEditorNew.addEventListener('click', () => { cnvEditorSource.value = ''; resetCnvEditorToBlank(); });
cnvEditorModeSelect.addEventListener('change', () => {
  if (cnvEditorReadOnly) return;
  cnvEditorMode = cnvEditorModeSelect.value as CnvDefinition['mode'];
  renderCnvEditorTable();
});
cnvEditorCodeLengthInput.addEventListener('input', () => {
  if (cnvEditorReadOnly) return;
  cnvEditorCodeLength = Number(cnvEditorCodeLengthInput.value);
});
cnvEditorAddCategory.addEventListener('click', () => {
  if (cnvEditorReadOnly) return;
  const nextSequence = cnvEditorRows.reduce((max, row) => Math.max(max, row.sequence), 0) + 1;
  cnvEditorRows.push({ sequence: nextSequence, label: '', subtotal: '', codesText: '' });
  renderCnvEditorTable();
});
cnvEditorPreviewButton.addEventListener('click', () => { void updateCnvEditorPreview(); });
// "Numera CNV" do TabWin: 1, 2, 3… na ordem da tabela. Linhas que repetem o
// mesmo número (continuação da lista de códigos) continuam juntas, e os
// subtotais passam a apontar para o número novo.
cnvEditorRenumber.addEventListener('click', () => {
  if (cnvEditorReadOnly) return;
  const novo = new Map<number, number>();
  for (const row of cnvEditorRows) if (!novo.has(row.sequence)) novo.set(row.sequence, novo.size + 1);
  cnvEditorRows = cnvEditorRows.map((row) => {
    const alvo = row.subtotal.trim();
    const subtotal = /^\d+$/.test(alvo) && novo.has(Number(alvo)) ? String(novo.get(Number(alvo))) : row.subtotal;
    return { ...row, sequence: novo.get(row.sequence)!, subtotal };
  });
  renderCnvEditorTable();
  showToast(`Categorias numeradas de 1 a ${novo.size}`);
});
// "Gera CNV" do TabWin: uma categoria por código que existe no campo.
cnvEditorGenerate.addEventListener('click', () => {
  const field = cnvEditorPreviewField.value;
  if (!field) return;
  void (async () => {
    try {
      const { values, truncated } = await deps.valoresDistintos(field, 5000);
      const definition = generateCnvFromValues(values);
      setCnvEditorReadOnly(false);
      cnvEditorRows = rowsFromDefinition(definition);
      cnvEditorMode = definition.mode;
      cnvEditorCodeLength = definition.codeLength;
      cnvEditorModeSelect.value = cnvEditorMode;
      cnvEditorCodeLengthInput.value = String(cnvEditorCodeLength);
      cnvEditorFilename.value = `${field}.cnv`;
      cnvEditorSource.value = '';
      renderCnvEditorTable();
      showToast(truncated
        ? `${field}: ${integerFormat.format(values.length)} códigos (o campo tem mais; a lista parou aí). Escreva a descrição de cada um.`
        : `${field}: ${integerFormat.format(values.length)} códigos. Escreva a descrição de cada um.`, truncated);
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error), true);
    }
  })();
});
cnvEditorApply.addEventListener('click', applyCnvEditor);
cnvEditorDownload.addEventListener('click', downloadCnvEditorFile);

return { abrir: openCnvEditor };
}
