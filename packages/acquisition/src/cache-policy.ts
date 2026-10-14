/**
 * Quanto do navegador o TabSis pode ocupar com arquivos baixados.
 *
 * O professor pediu cuidado com o cache do navegador, e com razão: a versão
 * anterior guardava até seis pacotes sem olhar o tamanho. Seis arquivos
 * nacionais do SINASC passam de 700 MB — o navegador apaga o site inteiro
 * quando a origem estoura a cota, e num celular isso chega rápido.
 *
 * A política agora é por BYTES, com três regras:
 *
 * 1. Teto: o menor entre {@link CACHE_HARD_LIMIT_BYTES} e uma fração da cota
 *    que o próprio navegador informa (`navigator.storage.estimate()`), descontado
 *    o que outras partes do site já usam.
 * 2. Sai primeiro o mais antigo; o recém-baixado nunca é o escolhido, mesmo se
 *    sozinho passar do teto — a pessoa acabou de esperar por ele.
 * 3. Continua valendo o teto de quantidade, para a lista "recentes" não virar
 *    um depósito.
 *
 * Funções puras: quem mexe no IndexedDB é `apps/web/src/archive-cache.ts`.
 */

export const CACHE_HARD_LIMIT_BYTES = 1536 * 1024 * 1024;
/** Fração da cota livre da origem que o cache de arquivos pode usar. */
export const CACHE_QUOTA_FRACTION = 0.5;
export const CACHE_MAX_ENTRIES = 12;
/** Sem estimativa do navegador (Safari antigo, modo privado), um teto prudente. */
export const CACHE_FALLBACK_BUDGET_BYTES = 512 * 1024 * 1024;

export interface CacheEntryMeta {
  key: string;
  size: number;
  savedAt: number;
}

export interface StorageEstimateLike {
  quota?: number;
  usage?: number;
}

/**
 * Teto em bytes para o cache de arquivos.
 *
 * `cacheBytes` é o que o próprio cache já ocupa: ele entra na conta como
 * espaço "nosso", senão cada arquivo guardado diminuiria o teto do seguinte.
 */
export function cacheBudgetBytes(estimate: StorageEstimateLike | null | undefined, cacheBytes: number): number {
  const quota = estimate?.quota;
  if (!quota || !Number.isFinite(quota) || quota <= 0) {
    return Math.min(CACHE_HARD_LIMIT_BYTES, CACHE_FALLBACK_BUDGET_BYTES);
  }
  const usage = Math.max(0, estimate?.usage ?? 0);
  const outros = Math.max(0, usage - cacheBytes);
  const disponivel = Math.max(0, quota - outros);
  return Math.max(0, Math.min(CACHE_HARD_LIMIT_BYTES, Math.floor(disponivel * CACHE_QUOTA_FRACTION)));
}

/**
 * Quais entradas apagar para caber no teto.
 *
 * `keep` é a chave recém-gravada, que nunca sai. As demais saem da mais
 * antiga para a mais nova até a soma e a contagem caberem.
 */
export function chooseCacheEvictions(
  entries: readonly CacheEntryMeta[],
  budgetBytes: number,
  options: { keep?: string; maxEntries?: number } = {},
): string[] {
  const maxEntries = options.maxEntries ?? CACHE_MAX_ENTRIES;
  let total = entries.reduce((sum, entry) => sum + Math.max(0, entry.size), 0);
  let count = entries.length;
  const removiveis = entries
    .filter((entry) => entry.key !== options.keep)
    .sort((a, b) => a.savedAt - b.savedAt || a.key.localeCompare(b.key));
  const sair: string[] = [];
  for (const entry of removiveis) {
    if (total <= budgetBytes && count <= maxEntries) break;
    sair.push(entry.key);
    total -= Math.max(0, entry.size);
    count -= 1;
  }
  return sair;
}

/** Texto curto para a tela: "312 MB de 1,5 GB". */
export function describeCacheUsage(usedBytes: number, budgetBytes: number): string {
  const fmt = (bytes: number): string => {
    if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1).replace('.', ',')} GB`;
    if (bytes >= 1024 ** 2) return `${Math.round(bytes / 1024 ** 2)} MB`;
    return `${Math.max(0, Math.round(bytes / 1024))} KB`;
  };
  return `${fmt(usedBytes)} de ${fmt(budgetBytes)}`;
}
