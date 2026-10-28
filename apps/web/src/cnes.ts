/**
 * Cadastro dos estabelecimentos de saúde (CNES): nome, município e
 * coordenadas, para dar nome ao código na aba Microdados e pôr cada
 * estabelecimento como um ponto no mapa.
 *
 * Os arquivos ficam no espelho R2, um por UF (gerados por
 * `scripts/gerar-cnes-espelho.mjs` a partir do OpenDataSUS). O manifesto, com
 * o hash de cada um, vem do próprio site (`cnes.json`, no repositório): o que
 * chega do espelho só é usado se o hash bater.
 */

export interface Estabelecimento {
  nome: string;
  /** Código IBGE de 6 dígitos. */
  municipio: string;
  latitude: number | null;
  longitude: number | null;
}

interface ManifestoCnes {
  schema: 'tabsis.cnes';
  baseUrl: string;
  fonte: string;
  dataDaFonte: string;
  ufs: Record<string, { registros: number; sha256: string; bytesComprimidos: number }>;
}

/** Campos que guardam o CNES do estabelecimento, por sistema. */
export const CAMPOS_DE_CNES = ['ID_UNIDADE', 'CNES', 'CODESTAB', 'PA_CODUNI'];

/** Os 7 dígitos do CNES: o SIM e o SIA às vezes gravam sem os zeros da frente. */
export function normalizarCnes(valor: string): string {
  const limpo = valor.trim();
  return /^\d{1,7}$/.test(limpo) ? limpo.padStart(7, '0') : limpo;
}

let manifesto: Promise<ManifestoCnes> | null = null;
const porUf = new Map<string, Promise<Map<string, Estabelecimento>>>();

function lerManifesto(): Promise<ManifestoCnes> {
  manifesto ??= fetch(new URL('cnes.json', document.baseURI)).then(async (resposta) => {
    if (!resposta.ok) throw new Error(`Cadastro do CNES indisponível (HTTP ${resposta.status})`);
    const dado = await resposta.json() as ManifestoCnes;
    if (dado.schema !== 'tabsis.cnes') throw new Error('Manifesto do CNES inválido');
    return dado;
  }).catch((erro: unknown) => { manifesto = null; throw erro; });
  return manifesto;
}

async function sha256(bytes: ArrayBuffer): Promise<string> {
  const resumo = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(resumo)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function carregarUf(uf: string): Promise<Map<string, Estabelecimento>> {
  let pedido = porUf.get(uf);
  if (pedido) return pedido;
  pedido = (async () => {
    const dados = await lerManifesto();
    const esperado = dados.ufs[uf];
    if (!esperado) return new Map<string, Estabelecimento>();
    const resposta = await fetch(`${dados.baseUrl}/cnes/${uf}.json`);
    if (!resposta.ok) throw new Error(`Cadastro do CNES da UF ${uf} indisponível (HTTP ${resposta.status})`);
    const bytes = await resposta.arrayBuffer();
    if (await sha256(bytes) !== esperado.sha256) throw new Error(`O cadastro do CNES da UF ${uf} chegou diferente do esperado (hash não confere)`);
    const lista = JSON.parse(new TextDecoder().decode(bytes)) as Array<[string, string, string, number | null, number | null]>;
    return new Map(lista.map(([cnes, nome, municipio, latitude, longitude]) => [cnes, { nome, municipio, latitude, longitude }]));
  })();
  // Falhou: a próxima tentativa pede de novo, em vez de lembrar do erro.
  pedido.catch(() => porUf.delete(uf));
  porUf.set(uf, pedido);
  return pedido;
}

/**
 * Os estabelecimentos das UFs pedidas (lista vazia: todas), num mapa só
 * (CNES → estabelecimento).
 * `progresso` recebe quantas UFs já chegaram; os arquivos têm de 20 KB (RR) a
 * 3 MB (SP), comprimidos.
 */
export async function carregarCnes(ufs: readonly string[], progresso?: (prontas: number, total: number) => void): Promise<Map<string, Estabelecimento>> {
  // Sem UF conhecida (arquivo sem campo de município), todas.
  const lista = ufs.length ? [...new Set(ufs)].sort() : Object.keys((await lerManifesto()).ufs).sort();
  let prontas = 0;
  const partes = await Promise.all(lista.map((uf) => carregarUf(uf).then((mapa) => {
    prontas += 1;
    progresso?.(prontas, lista.length);
    return mapa;
  })));
  const junto = new Map<string, Estabelecimento>();
  for (const parte of partes) for (const [cnes, estabelecimento] of parte) junto.set(cnes, estabelecimento);
  return junto;
}

/** De onde vem o cadastro, para dizer na tela. */
export async function fonteDoCnes(): Promise<string> {
  const dados = await lerManifesto();
  return `${dados.fonte}, versão de ${dados.dataDaFonte.split('-').reverse().join('/')}`;
}
