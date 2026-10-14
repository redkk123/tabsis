import type { DatasusSearchQuery } from '../../../packages/acquisition/src/datasus.ts';
import {
  cacheBudgetBytes,
  chooseCacheEvictions,
  type CacheEntryMeta,
} from '../../../packages/acquisition/src/cache-policy.ts';

export type CachedArchiveRole = 'data' | 'auxiliary';

export interface CachedArchiveSource {
  name: string;
  address: string;
  source: string;
  modality: string;
  catalogQuery?: DatasusSearchQuery;
}

interface CachedArchive {
  key: string;
  savedAt: number;
  bytes: ArrayBuffer;
  sha256?: string;
  role?: CachedArchiveRole;
  sources?: CachedArchiveSource[];
}

export interface CachedArchiveSummary {
  key: string;
  savedAt: number;
  size: number;
  sha256: string;
  role: CachedArchiveRole;
  sources: CachedArchiveSource[];
}

export interface CachedArchivePayload {
  summary: CachedArchiveSummary;
  bytes: Uint8Array;
}

const DATABASE_NAME = 'tabwin-web';
/**
 * Versão 2 acrescenta `archive-meta`: um resumo por pacote, sem os bytes.
 * Listar o cache e decidir o que apagar passam a ler só essa store — antes,
 * cada listagem trazia para a memória todos os pacotes guardados.
 */
const DATABASE_VERSION = 2;
const STORE_NAME = 'official-archives';
const META_STORE = 'archive-meta';

type ArchiveMeta = Omit<CachedArchive, 'bytes'> & { size: number };

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        const store = database.createObjectStore(STORE_NAME, { keyPath: 'key' });
        store.createIndex('savedAt', 'savedAt');
      }
      if (!database.objectStoreNames.contains(META_STORE)) {
        const meta = database.createObjectStore(META_STORE, { keyPath: 'key' });
        meta.createIndex('savedAt', 'savedAt');
        // Quem já tinha pacotes da versão 1 ganha o resumo deles agora, uma
        // vez, dentro da própria atualização — sem perder nada do que baixou.
        const archives = request.transaction!.objectStore(STORE_NAME);
        const cursorRequest = archives.openCursor();
        cursorRequest.onsuccess = () => {
          const cursor = cursorRequest.result;
          if (!cursor) return;
          meta.put(metaOf(cursor.value as CachedArchive));
          cursor.continue();
        };
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Falha ao abrir o cache local'));
  });
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Falha no cache local'));
  });
}

function legacySources(key: string): CachedArchiveSource[] {
  const prefix = 'official-v1:';
  if (!key.startsWith(prefix)) return [];
  return key.slice(prefix.length).split('|').flatMap((address) => {
    try {
      const url = new URL(address);
      const name = url.pathname.split('/').pop() ?? '';
      return name ? [{ name, address, source: '', modality: '' }] : [];
    } catch {
      return [];
    }
  });
}

function metaOf(entry: CachedArchive): ArchiveMeta {
  const { bytes, ...rest } = entry;
  return { ...rest, size: bytes.byteLength };
}

function summarize(entry: CachedArchive | ArchiveMeta): CachedArchiveSummary {
  const sources = entry.sources?.length ? entry.sources : legacySources(entry.key);
  return {
    key: entry.key,
    savedAt: entry.savedAt,
    size: 'bytes' in entry ? entry.bytes.byteLength : entry.size,
    sha256: entry.sha256 ?? '',
    role: entry.role ?? (sources.some((source) => /\.(dbc|dbf)$/i.test(source.name)) ? 'data' : 'auxiliary'),
    sources,
  };
}

export async function readCachedArchive(key: string, maxAgeMs: number): Promise<CachedArchivePayload | null> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, 'readonly');
    const entry = await requestResult(transaction.objectStore(STORE_NAME).get(key)) as CachedArchive | undefined;
    if (!entry || Date.now() - entry.savedAt > maxAgeMs) return null;
    return { summary: summarize(entry), bytes: new Uint8Array(entry.bytes) };
  } finally {
    database.close();
  }
}

/**
 * Resumos dos pacotes guardados, sem trazer os pacotes.
 *
 * Lê só a store de metadados (versão 2 do banco). Antes, o cursor percorria a
 * store dos pacotes e, por mais que soltasse cada registro ao avançar, o pico
 * de memória era o maior pacote — num aparelho modesto, a aba morrendo.
 */
export async function listCachedArchives(): Promise<CachedArchiveSummary[]> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(META_STORE, 'readonly');
    const metas = await requestResult(transaction.objectStore(META_STORE).getAll()) as ArchiveMeta[];
    return metas.map(summarize).sort((a, b) => b.savedAt - a.savedAt);
  } finally {
    database.close();
  }
}

/** Bytes que o cache de pacotes ocupa, somados pelos metadados. */
export async function cachedArchiveBytes(): Promise<number> {
  return (await listCachedArchives()).reduce((sum, item) => sum + item.size, 0);
}

async function storageEstimate(): Promise<StorageEstimate | null> {
  try {
    return await navigator.storage?.estimate?.() ?? null;
  } catch {
    return null;
  }
}

/** O que o cache usa e até quanto pode usar neste navegador agora. */
export async function describeCacheBudget(): Promise<{ usedBytes: number; budgetBytes: number }> {
  const usedBytes = await cachedArchiveBytes();
  return { usedBytes, budgetBytes: cacheBudgetBytes(await storageEstimate(), usedBytes) };
}

export async function deleteCachedArchive(key: string): Promise<void> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction([STORE_NAME, META_STORE], 'readwrite');
    transaction.objectStore(META_STORE).delete(key);
    await requestResult(transaction.objectStore(STORE_NAME).delete(key));
  } finally {
    database.close();
  }
}

export async function clearCachedArchives(): Promise<void> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction([STORE_NAME, META_STORE], 'readwrite');
    transaction.objectStore(META_STORE).clear();
    await requestResult(transaction.objectStore(STORE_NAME).clear());
  } finally {
    database.close();
  }
}

export async function writeCachedArchive(
  key: string,
  bytes: Uint8Array,
  metadata: {
    sha256: string;
    role: CachedArchiveRole;
    sources: CachedArchiveSource[];
  },
): Promise<CachedArchiveSummary> {
  const database = await openDatabase();
  try {
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    const entry: CachedArchive = { key, savedAt: Date.now(), bytes: buffer, ...metadata };

    // Abre espaço ANTES de gravar: o que manda é o teto em bytes que o
    // navegador comporta, não um número fixo de arquivos.
    const read = database.transaction(META_STORE, 'readonly');
    const metas = (await requestResult(read.objectStore(META_STORE).getAll()) as ArchiveMeta[])
      .filter((item) => item.key !== key);
    const ocupado = metas.reduce((sum, item) => sum + item.size, 0);
    const budget = cacheBudgetBytes(await storageEstimate(), ocupado);
    const candidates: CacheEntryMeta[] = [
      ...metas.map((item) => ({ key: item.key, size: item.size, savedAt: item.savedAt })),
      { key, size: buffer.byteLength, savedAt: entry.savedAt },
    ];
    const evict = chooseCacheEvictions(candidates, budget, { keep: key });
    if (evict.length) {
      const cleanup = database.transaction([STORE_NAME, META_STORE], 'readwrite');
      for (const expired of evict) {
        cleanup.objectStore(STORE_NAME).delete(expired);
        cleanup.objectStore(META_STORE).delete(expired);
      }
      await new Promise<void>((resolve, reject) => {
        cleanup.oncomplete = () => resolve();
        cleanup.onerror = () => reject(cleanup.error ?? new Error('Falha ao liberar espaço no cache local'));
      });
    }
    // Pacote maior que o teto inteiro: não guarda. Abrir o arquivo continua
    // funcionando; só não fica cópia para a próxima vez.
    if (buffer.byteLength > budget) return summarize(entry);

    const write = database.transaction([STORE_NAME, META_STORE], 'readwrite');
    write.objectStore(META_STORE).put(metaOf(entry));
    await requestResult(write.objectStore(STORE_NAME).put(entry));
    return summarize(entry);
  } finally {
    database.close();
  }
}
