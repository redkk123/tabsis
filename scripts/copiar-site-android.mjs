/**
 * Copia o site construído (dist-web) para dentro do app Android, em
 * apps/android/app/src/main/assets/site, sem os mapas de código-fonte (.map),
 * que só servem para depurar e dobrariam o tamanho do APK.
 *
 * Uso: npm run android:site   (constrói o site e copia)
 */
import { cp, rm, stat } from 'node:fs/promises';
import path from 'node:path';

const origem = path.resolve('dist-web');
const destino = path.resolve('apps/android/app/src/main/assets/site');
await stat(path.join(origem, 'index.html')).catch(() => {
  throw new Error('dist-web/index.html não existe: rode npm run web:build antes.');
});
await rm(destino, { recursive: true, force: true });
await cp(origem, destino, { recursive: true, filter: (arquivo) => !arquivo.endsWith('.map') });
console.log(`site copiado para ${path.relative(process.cwd(), destino)}`);
