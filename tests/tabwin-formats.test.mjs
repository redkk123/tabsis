import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { columnDecimals, tabulationToTabwinPrn, tabulationToTabwinSql, tabulationToTabwinTab } from '../dist/packages/export/src/tabwin-formats.js';
import { encodeWindows1252, parseTabFile } from '../dist/packages/formats/src/index.js';

const fixture = (name) => readFile(new URL(`../fixtures/oracle/tabwin-salvar-como/${name}`, import.meta.url));
const sexo = {
  rows: [{ key: '1', label: 'Masculino', source: 'conversion' }, { key: '3', label: 'Feminino', source: 'conversion' }, { key: '9', label: 'Ignorado', source: 'conversion' }],
  columns: [{ key: 'freq', label: 'Freqüência', source: 'raw' }, { key: 'VAL_TOT', label: 'Valor Total', source: 'raw' }],
  cells: [[1761, 2077684.41], [2554, 2230388.35], [0, 0]],
  warnings: [], recordsSeen: 4315, recordsAccepted: 4315,
};
const log = ['[Opções]', 'DEF=C:\\TabWin\\G001\\TESTE.DEF', 'PATH=C:\\TabWin\\G001\\RD*.DBC', 'Linha=Sexo', 'Incremento=Freqüência',
  'Incremento=Valor Total', 'Suprime_Linhas_Zeradas=false', 'Suprime_Colunas_Zeradas=true', 'Não_Classificados=0', '[Arquivos]',
  'RDAC2401.dbc', 'Registros_Processados= 4315', 'Tempo_Decorrido= 0:00'].join('\r\n');
const context = { rowLabel: 'Sexo', title: 'Teste TabSis oraculo', subtitle: 'Freqüência Valor Total segundo Sexo', log };

test('.TAB igual, byte a byte, ao que o TabWin 4.15 grava', async () => {
  const bytes = encodeWindows1252(tabulationToTabwinTab(sexo, context));
  assert.deepEqual(Buffer.from(bytes), await fixture('sexo-valor.tab'));
});

test('.PRN e .SQL iguais aos do TabWin', async () => {
  assert.deepEqual(Buffer.from(encodeWindows1252(tabulationToTabwinPrn(sexo, context))), await fixture('sexo-valor.prn'));
  assert.deepEqual(Buffer.from(encodeWindows1252(tabulationToTabwinSql(sexo, { ...context, tableName: 'fmt7' }))), await fixture('sexo-valor.sql'));
});

test('com Colunas, a coluna "Total" no fim, como na captura TO3', async () => {
  const original = parseTabFile(new TextDecoder('windows-1252').decode(await fixture('to3-coluna.tab')));
  const m = original.matrix;
  // O leitor já separa a coluna e a linha "Total"; se vierem, ficam de fora.
  const totalColumn = m.columnLabels.includes('Total') ? m.columnLabels.indexOf('Total') : m.columnLabels.length;
  const result = {
    rows: m.rowLabels.map((label, i) => ({ key: `r${i}`, label, source: 'conversion' })),
    columns: m.columnLabels.slice(0, totalColumn).map((label, i) => ({ key: `c${i}`, label, source: 'conversion' })),
    cells: m.cells.map((row) => row.slice(0, totalColumn).map(Number)),
    warnings: [], recordsSeen: 4315, recordsAccepted: 4315,
  };
  const text = new TextDecoder('windows-1252').decode(await fixture('to3-coluna.tab'));
  const logText = text.split('\r\n').slice(3, text.split('\r\n').findIndex((l) => l.startsWith('"'))).join('\r\n');
  const written = tabulationToTabwinTab(result, {
    rowLabel: m.cornerLabel, title: 'Movimento de AIH - Arquivos Reduzidos',
    subtitle: 'Freqüência por Caráter atendimento segundo Complexidade do Procedimento', log: logText, rowTotalColumn: true,
  });
  assert.equal(written, text);
});

test('.TAB sem nenhuma coluna com valor: aviso do TabWin entre o log e a coluna DUMMY', () => {
  // Como o TabWin 4.15 gravou na varredura de combinações (2026-10-24).
  const vazio = {
    rows: [{ key: '1', label: 'Masculino', source: 'conversion' }, { key: '2', label: 'Feminino', source: 'conversion' }],
    columns: [{ key: '__dummy__', label: 'DUMMY', source: 'raw' }],
    cells: [[0], [0]], warnings: [], recordsSeen: 10, recordsAccepted: 0, noRecordsSelected: true,
  };
  const linhas = tabulationToTabwinTab(vazio, { rowLabel: 'Sexo', log: '[Opções]\r\nLinha=Sexo\r\nColuna=Raça\r\nTempo_Decorrido= 0:00', rowTotalColumn: false }).split('\r\n');
  assert.deepEqual(linhas.slice(6), ['Tempo_Decorrido= 0:00', 'NENHUM REGISTRO SELECIONADO', '"Sexo";"DUMMY"', '"Masculino";0', '"Feminino";0', '"Total";0', '']);
});

test('casas decimais: as fixadas na coluna, ou as que os valores pedem', () => {
  assert.equal(columnDecimals(sexo, 0), 0);
  assert.equal(columnDecimals(sexo, 1), 2);
  assert.equal(columnDecimals({ ...sexo, columns: [sexo.columns[0], { ...sexo.columns[1], decimals: 0 }] }, 1), 0);
});

test('Colar tabela: TSV de planilha vira .TAB, com milhar e decimal do pt-BR e do inglês', async () => {
  const { pastedNumber, tabFileFromClipboard, tabFileNumber } = await import('../dist/packages/formats/src/index.js');
  assert.equal(pastedNumber('1.761'), 1761);
  assert.equal(pastedNumber('2.077.684,41'), 2077684.41);
  assert.equal(pastedNumber('2,077,684.41'), 2077684.41);
  assert.equal(pastedNumber('47,27'), 47.27);
  assert.equal(pastedNumber('47.27'), 47.27);
  assert.equal(pastedNumber('-'), 0);
  assert.equal(pastedNumber('abc'), null);
  const tab = parseTabFile(tabFileFromClipboard('Sexo\tFreqüência\tValor Total\nMasculino\t1.761\t2.077.684,41\nFeminino\t2.554\t2.230.388,35\nTotal\t4.315\t4.308.072,76\n'));
  assert.deepEqual(tab.matrix.rowLabels, ['Masculino', 'Feminino']);
  assert.deepEqual(tab.matrix.columnLabels, ['Freqüência', 'Valor Total']);
  assert.deepEqual(tab.matrix.cells.map((row) => row.map(tabFileNumber)), [[1761, 2077684.41], [2554, 2230388.35]]);
  assert.throws(() => tabFileFromClipboard('só uma linha'), /cole uma tabela/);
  assert.throws(() => tabFileFromClipboard('A\tB\nx\tnão'), /não é número/);
});

test('notas técnicas: até 32, com alvo, sem repetir o alvo', async () => {
  const { validateTechnicalNotes, MAX_TECHNICAL_NOTES } = await import('../dist/packages/core/src/index.js');
  validateTechnicalNotes([{ rowKey: '1', text: 'Inclui transferências' }, { rowKey: '1', columnKey: 'freq', text: 'Revisado' }, { columnKey: 'freq', text: 'AIH aprovadas' }], 'teste');
  assert.equal(MAX_TECHNICAL_NOTES, 32);
  assert.throws(() => validateTechnicalNotes([{ text: 'sem alvo' }], 'teste'), /invalid technical note/);
  assert.throws(() => validateTechnicalNotes([{ rowKey: '1', text: '  ' }], 'teste'), /invalid technical note/);
  assert.throws(() => validateTechnicalNotes([{ rowKey: '1', text: 'a' }, { rowKey: '1', text: 'b' }], 'teste'), /duplicate/);
  assert.throws(() => validateTechnicalNotes(Array.from({ length: 33 }, (_, i) => ({ rowKey: String(i), text: 'x' })), 'teste'), /invalid technical notes/);
});
