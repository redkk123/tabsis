import { defineConfig, type Plugin } from 'vite';

/**
 * Em produção, `/lab/` serve `lab/index.html` (o Lab publicado em `public/lab`).
 * O servidor de desenvolvimento do Vite não faz isso para pastas de `public`:
 * devolvia a página do TabSis no lugar do Lab, e "Abrir no Python" não tinha
 * como ser testado localmente.
 */
function labComoEmProducao(): Plugin {
  return {
    name: 'lab-como-em-producao',
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        if (req.url && /^\/lab\/?(\?|$)/.test(req.url)) req.url = req.url.replace(/^\/lab\/?/, '/lab/index.html');
        next();
      });
    },
  };
}

export default defineConfig({
  root: 'apps/web',
  base: './',
  plugins: [labComoEmProducao()],
  build: {
    outDir: '../../dist-web',
    emptyOutDir: true,
    sourcemap: true,
  },
});
