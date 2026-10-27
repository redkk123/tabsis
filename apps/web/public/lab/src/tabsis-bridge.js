/**
 * Ponte com o TabSis: "Abrir no Python" no TabSis abre esta página com
 * `?origem=tabsis` e manda os microdados da tabela atual e um caderno pronto.
 *
 * As duas páginas são da mesma origem (tabweb.me e tabweb.me/lab): a conversa
 * é por postMessage entre as abas, sem servidor. Esta página só aceita a
 * mensagem da aba que a abriu (window.opener) e da própria origem; o formato
 * é conferido aqui e os arquivos passam pelos mesmos limites de sempre.
 */

export const TABSIS_ORIGIN_PARAM = 'origem';

/** Confere e normaliza o que o TabSis mandou; recusa o que não for o formato. */
export function parseTabsisPayload(data) {
  if (!data || typeof data !== 'object' || data.tipo !== 'tabsis:dados') return null;
  const { arquivos, caderno } = data;
  if (!Array.isArray(arquivos) || !arquivos.length || arquivos.length > 8) throw new Error('O TabSis mandou uma lista de arquivos inválida');
  const files = arquivos.map((arquivo) => {
    if (!arquivo || typeof arquivo.name !== 'string' || !(arquivo.bytes instanceof ArrayBuffer)) throw new Error('O TabSis mandou um arquivo inválido');
    return { name: arquivo.name, bytes: arquivo.bytes };
  });
  if (!caderno || typeof caderno.title !== 'string' || !Array.isArray(caderno.cells) || !caderno.cells.length) {
    throw new Error('O TabSis mandou um caderno inválido');
  }
  const cells = caderno.cells.map((cell) => {
    if (!cell || !['python', 'r'].includes(cell.runtime) || typeof cell.code !== 'string') throw new Error('O TabSis mandou uma célula inválida');
    return { runtime: cell.runtime, code: cell.code };
  });
  return { files, title: caderno.title.slice(0, 120), cells };
}

/**
 * Espera os dados do TabSis quando a página foi aberta por ele. Chama
 * `onPayload` uma vez; devolve false se a página não veio do TabSis.
 */
export function listenForTabsis({ onPayload, onError, win = window }) {
  const params = new URLSearchParams(win.location.search);
  if (params.get(TABSIS_ORIGIN_PARAM) !== 'tabsis' || !win.opener) return false;
  const opener = win.opener;
  const origin = win.location.origin;
  const receive = (event) => {
    if (event.origin !== origin || event.source !== opener) return;
    let payload;
    try {
      payload = parseTabsisPayload(event.data);
    } catch (error) {
      win.removeEventListener('message', receive);
      onError?.(error);
      return;
    }
    if (!payload) return;
    win.removeEventListener('message', receive);
    onPayload(payload);
  };
  win.addEventListener('message', receive);
  opener.postMessage({ tipo: 'tabsis:pronto' }, origin);
  // Tira o ?origem=tabsis da barra: recarregar não deve esperar dados de novo.
  win.history?.replaceState?.(null, '', win.location.pathname);
  return true;
}
