/**
 * A aba "Consulta": SQL sobre os dados abertos, com o DuckDB no navegador.
 *
 * Separada do main.ts (2026-10-14): ela só conversa com o resto do aplicativo
 * pelas funções de {@link AbaConsultaDeps} — ler registros do worker, saber o
 * nome e os campos do conjunto aberto, baixar um arquivo.
 */

import { checkIngestBudget } from '../../../packages/analysis/src/duckdb-surface.ts';
import {
  exportQuery,
  loadRecordsAsTable,
  quoteIdentifier,
  runQuery,
  type DuckDbExportFormat,
  shutdownDuckDb,
  tableNameFor,
  type DuckDbQueryResult,
} from './duckdb-engine.ts';

// ---------------------------------------------------------------------------
// Consulta SQL — superfície de análise, separada do motor de tabulação.
//
// A tabela do TabWin continua saindo do executor de referência, provado contra
// o TabWin 4.15 com tolerância zero. Aqui é outra coisa: junções, percentis,
// funções de janela, faixas contínuas — o que o modelo de plano não expressa e
// que hoje só existia em script fora do aplicativo.
//
// O motor pesa ~7 MB e só é baixado quando alguém carrega dados nesta aba.
// ---------------------------------------------------------------------------

/** Teto de linhas trazidas do worker para o motor de consulta. */
const QUERY_MAX_RECORDS = 400_000;

export interface AbaConsultaDeps {
  /** Campos do arquivo aberto, na ordem do cabeçalho. */
  campos(): string[];
  nomeDoConjunto(): string;
  registrosNoConjunto(): number;
  lerRegistros(campos: string[], maximo: number): Promise<{ records: Array<Record<string, unknown>>; seen: number; truncated: boolean }>;
  baixar(blob: Blob, nome: string): void;
  ligarSelecionarTodos(botao: HTMLButtonElement, lista: HTMLSelectElement, rotulo: string): void;
}

export interface AbaConsulta {
  /** Refaz a lista de campos quando um arquivo é aberto. */
  atualizarCampos(): void;
}

function element<T extends Element>(selector: string): T {
  const found = document.querySelector<T>(selector);
  if (!found) throw new Error(`Elemento ausente: ${selector}`);
  return found;
}

const integerFormat = new Intl.NumberFormat('pt-BR');

export function criarAbaConsulta(deps: AbaConsultaDeps): AbaConsulta {

  const queryStatus = element<HTMLElement>('#query-status');
  const querySql = element<HTMLTextAreaElement>('#query-sql');
  const queryRun = element<HTMLButtonElement>('#query-run');
  const queryExport = element<HTMLButtonElement>('#query-export');
  const queryExportParquet = element<HTMLButtonElement>('#query-export-parquet');
  const queryUnload = element<HTMLButtonElement>('#query-unload');
  const queryLoad = element<HTMLButtonElement>('#query-load');
  const queryResult = element<HTMLElement>('#query-result');
  const queryFields = element<HTMLSelectElement>('#query-fields');
  const queryFieldsAll = element<HTMLButtonElement>('#query-fields-all');

  let queryTable: string | null = null;
  let queryLastResult: DuckDbQueryResult | null = null;

  function setQueryStatus(mensagem: string, tom: 'normal' | 'trabalhando' | 'erro' = 'normal'): void {
    queryStatus.textContent = mensagem;
    queryStatus.classList.toggle('trabalhando', tom === 'trabalhando');
    queryStatus.classList.toggle('erro', tom === 'erro');
  }

  function renderQueryResult(resultado: DuckDbQueryResult): void {
    queryResult.replaceChildren();
    if (!resultado.rows.length) {
      const vazio = document.createElement('p');
      vazio.className = 'vazio';
      vazio.textContent = 'A consulta não devolveu nenhuma linha.';
      queryResult.append(vazio);
      return;
    }
    const table = document.createElement('table');
    const thead = document.createElement('thead');
    const headRow = document.createElement('tr');
    for (const coluna of resultado.columns) {
      const th = document.createElement('th');
      th.textContent = coluna.name;
      headRow.append(th);
    }
    thead.append(headRow);
    const tbody = document.createElement('tbody');
    for (const linha of resultado.rows) {
      const tr = document.createElement('tr');
      linha.forEach((valor, indice) => {
        const td = document.createElement('td');
        if (resultado.columns[indice]?.type === 'número') td.className = 'numero';
        td.textContent = valor === null
          ? '—'
          : valor instanceof Date ? valor.toISOString().slice(0, 10) : String(valor);
        tr.append(td);
      });
      tbody.append(tr);
    }
    table.append(thead, tbody);
    queryResult.append(table);
  }

  /**
   * Preenche a lista de campos quando um arquivo é aberto.
   *
   * Marca todos por padrão quando cabem no orçamento, e nenhum quando não cabem
   * — obrigar a escolha é melhor que deixar marcado algo que vai ser recusado.
   */
  function populateQueryFields(): void {
    const campos = deps.campos();
    queryFields.replaceChildren();
    for (const nome of campos) queryFields.add(new Option(nome, nome));
    const orcamento = checkIngestBudget(deps.registrosNoConjunto() || QUERY_MAX_RECORDS, campos.length);
    for (const opcao of queryFields.options) opcao.selected = orcamento.withinBudget;
    if (campos.length) {
      setQueryStatus(orcamento.withinBudget
        ? `${campos.length} campo(s) disponíveis, todos marcados. ${orcamento.message}`
        : `${orcamento.message} Marque os campos que interessam.`,
        orcamento.withinBudget ? 'normal' : 'erro');
    }
  }

  async function loadDatasetIntoQueryEngine(): Promise<void> {
    if (!deps.nomeDoConjunto()) { setQueryStatus('Abra um arquivo antes de consultar.', 'erro'); return; }
    const campos = [...queryFields.selectedOptions].map((opcao) => opcao.value);
    if (!campos.length) { setQueryStatus('Marque ao menos um campo para carregar.', 'erro'); return; }
    // O limite é conferido ANTES de pedir os registros: descobrir que não cabe
    // depois de materializar quatrocentas mil linhas seria descobrir tarde.
    const orcamento = checkIngestBudget(
      Math.min(deps.registrosNoConjunto() || QUERY_MAX_RECORDS, QUERY_MAX_RECORDS), campos.length);
    if (!orcamento.withinBudget) { setQueryStatus(orcamento.message, 'erro'); return; }
    queryLoad.disabled = true;
    try {
      setQueryStatus('Lendo os registros do conjunto aberto…', 'trabalhando');
      const resposta = await deps.lerRegistros(campos, QUERY_MAX_RECORDS);

      const tabela = tableNameFor(deps.nomeDoConjunto());
      const carregada = await loadRecordsAsTable(
        tabela, resposta.records, campos, (mensagem) => setQueryStatus(mensagem, 'trabalhando'));
      queryTable = carregada.name;
      querySql.value = querySql.value.trim()
        || `SELECT * FROM ${quoteIdentifier(carregada.name)} LIMIT 100`;
      queryRun.disabled = false;
      queryUnload.disabled = false;
      // Um corte silencioso faria a consulta responder sobre um pedaço do
      // arquivo como se fosse o arquivo inteiro.
      const aviso = resposta.truncated
        ? ` ATENÇÃO: o conjunto tem ${integerFormat.format(resposta.seen)} registros e só os `
          + `${integerFormat.format(carregada.rowCount)} primeiros foram carregados. As consultas respondem`
          + ' sobre esse recorte, não sobre o arquivo inteiro.'
        : '';
      setQueryStatus(
        `Tabela ${carregada.name} pronta com ${integerFormat.format(carregada.rowCount)} linha(s) e `
        + `${integerFormat.format(carregada.columns.length)} coluna(s).${aviso}`,
        resposta.truncated ? 'erro' : 'normal',
      );
    } catch (error) {
      setQueryStatus(error instanceof Error ? error.message : String(error), 'erro');
    } finally {
      queryLoad.disabled = false;
    }
  }

  queryLoad.addEventListener('click', () => void loadDatasetIntoQueryEngine());

  queryRun.addEventListener('click', () => {
    const sql = querySql.value.trim();
    if (!sql) { setQueryStatus('Escreva uma consulta.', 'erro'); return; }
    queryRun.disabled = true;
    setQueryStatus('Executando…', 'trabalhando');
    void runQuery(sql)
      .then((resultado) => {
        queryLastResult = resultado;
        renderQueryResult(resultado);
        queryExport.disabled = !resultado.rows.length;
        queryExportParquet.disabled = !resultado.rows.length;
        const corte = resultado.truncated
          ? ` Mostrando as primeiras ${integerFormat.format(resultado.rows.length)}; exporte para ver todas.`
          : '';
        setQueryStatus(
          `${integerFormat.format(resultado.rowCount)} linha(s) em ${resultado.milliseconds.toFixed(0)} ms.${corte}`,
        );
      })
      .catch((error: unknown) => {
        queryLastResult = null;
        queryExport.disabled = true;
        queryExportParquet.disabled = true;
        queryResult.replaceChildren();
        setQueryStatus(error instanceof Error ? error.message : String(error), 'erro');
      })
      .finally(() => { queryRun.disabled = false; });
  });

  /**
   * Exporta o resultado INTEIRO da consulta.
   *
   * O que havia aqui antes escrevia `queryLastResult.rows`, que já vem cortado
   * em MAX_RESULT_ROWS — enquanto o status dizia "exporte para ver todas". Quem
   * consultasse quatrocentas mil linhas levava cinco mil acreditando ter tudo,
   * e nada na tela desmentia. Agora o próprio motor escreve o arquivo, rodando
   * a consulta de novo: as linhas não passam por JavaScript, então o custo é o
   * do arquivo e não o de um objeto por registro.
   */
  async function exportQueryResult(format: DuckDbExportFormat): Promise<void> {
    const sql = querySql.value.trim();
    if (!sql) { setQueryStatus('Escreva uma consulta antes de exportar.', 'erro'); return; }
    const botoes = [queryExport, queryExportParquet];
    for (const botao of botoes) botao.disabled = true;
    try {
      setQueryStatus(`Escrevendo o ${format === 'parquet' ? 'Parquet' : 'CSV'} com o resultado completo…`, 'trabalhando');
      const inicio = performance.now();
      const bytes = await exportQuery(sql, format);
      const nome = `consulta-${new Date().toISOString().slice(0, 10)}.${format}`;
      deps.baixar(
        new Blob([bytes as BlobPart], {
          type: format === 'parquet' ? 'application/vnd.apache.parquet' : 'text/csv;charset=utf-8',
        }),
        nome,
      );
      const mb = bytes.byteLength / 1048576;
      setQueryStatus(
        `${nome} pronto: ${mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.round(bytes.byteLength / 1024)} kB`}`
        + ` em ${((performance.now() - inicio) / 1000).toFixed(1)} s, com todas as linhas do resultado.`,
      );
    } catch (error) {
      setQueryStatus(error instanceof Error ? error.message : String(error), 'erro');
    } finally {
      // Só volta a habilitar o que fazia sentido antes: sem resultado na tela,
      // não há consulta conferida para exportar.
      for (const botao of botoes) botao.disabled = !queryLastResult?.rows.length;
    }
  }

  queryExport.addEventListener('click', () => void exportQueryResult('csv'));
  queryExportParquet.addEventListener('click', () => void exportQueryResult('parquet'));

  queryUnload.addEventListener('click', () => {
    queryUnload.disabled = true;
    void shutdownDuckDb().finally(() => {
      queryTable = null;
      queryLastResult = null;
      queryResult.replaceChildren();
      queryRun.disabled = true;
      queryExport.disabled = true;
      queryExportParquet.disabled = true;
      setQueryStatus('Motor descarregado. A memória dele voltou para o navegador.');
    });
  });

  deps.ligarSelecionarTodos(queryFieldsAll, queryFields, 'todos');

  return { atualizarCampos: populateQueryFields };
}
