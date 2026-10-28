/**
 * O TabSis Local do app Android, visto pelo site.
 *
 * O app (apps/android, LocalAndroid.java) fala o mesmo protocolo do TabSis
 * Local de computador, mas pela ponte do WebView (`window.TabSisAndroid`) em
 * vez de HTTP em 127.0.0.1: nenhuma porta aberta no aparelho. Aqui a ponte
 * vira um `fetch`, e o cliente de sempre (`bridge-client.ts`) não precisa
 * saber a diferença.
 */

export interface PonteLocalAndroid {
  localSaude(): string;
  localPedido(metodo: string, rota: string, corpo: string): string;
  localGuardado(id: string, nome: string): string;
  iniciarArquivo(): string;
  escreverParte(id: string, base64: string): void;
  descartarArquivo(id: string): void;
}

/** Endereço base que o cliente usa; só serve para montar as rotas. */
export const BASE_DO_APARELHO = 'tabsis-android://local';
/** O app aceita qualquer token: só a página dele enxerga a ponte. */
export const TOKEN_DO_APARELHO = 'aparelho-android-tabsis';

const PEDACO = 768 * 1024;

function json(status: number, corpo: string): Response {
  return new Response(corpo, { status, headers: { 'content-type': 'application/json; charset=utf-8' } });
}

function base64(bytes: Uint8Array): string {
  let texto = '';
  for (let i = 0; i < bytes.length; i += 0x8000) texto += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(texto);
}

export function temPonteLocal(ponte: unknown): ponte is PonteLocalAndroid {
  return typeof (ponte as Partial<PonteLocalAndroid> | undefined)?.localSaude === 'function';
}

/** Um `fetch` que responde às rotas do protocolo pela ponte do app. */
export function criarFetchDaPonte(ponte: PonteLocalAndroid): typeof fetch {
  return async (entrada: RequestInfo | URL, opcoes: RequestInit = {}): Promise<Response> => {
    const endereco = new URL(String(entrada instanceof Request ? entrada.url : entrada));
    const rota = endereco.pathname.replace(/^\/\/local/, '') || '/';
    const metodo = (opcoes.method ?? 'GET').toUpperCase();
    if (rota === '/health') return json(200, ponte.localSaude());
    if (rota === '/arquivo') {
      // Arquivo grande não cabe numa string da ponte: o WebView o entrega por
      // um endereço do próprio app, lido direto de Downloads/TabSis.
      const nome = endereco.searchParams.get('nome') ?? '';
      const pasta = endereco.searchParams.get('pasta') ?? 'principal';
      return fetch(new URL(`/__local/arquivo?nome=${encodeURIComponent(nome)}&pasta=${encodeURIComponent(pasta)}`, location.origin));
    }
    if (rota === '/guardados' && metodo === 'POST') {
      const nome = endereco.searchParams.get('nome') ?? '';
      const bytes = new Uint8Array(await new Response(opcoes.body ?? null).arrayBuffer());
      const id = ponte.iniciarArquivo();
      try {
        for (let i = 0; i < bytes.length; i += PEDACO) ponte.escreverParte(id, base64(bytes.subarray(i, i + PEDACO)));
      } catch (erro) {
        ponte.descartarArquivo(id);
        throw erro;
      }
      const resposta = JSON.parse(ponte.localGuardado(id, nome)) as { status: number; corpo: string };
      return json(resposta.status, resposta.corpo);
    }
    const corpo = typeof opcoes.body === 'string' ? opcoes.body : '';
    const resposta = JSON.parse(ponte.localPedido(metodo, rota, corpo)) as { status: number; corpo: string };
    return json(resposta.status, resposta.corpo);
  };
}
