import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Local stand-in for the Netlify Function: serves /api/* from the same handler
 * (server/yahoo.ts) so `npm run dev` and `npm run preview` behave like production.
 */
function apiMiddleware(): Plugin {
  const attach = (server: { middlewares: { use: (fn: (req: any, res: any, next: () => void) => void) => void }; ssrLoadModule?: (id: string) => Promise<any> }) => {
    server.middlewares.use(async (req, res, next) => {
      if (!req.url?.startsWith('/api/')) return next();
      try {
        const mod = server.ssrLoadModule ? await server.ssrLoadModule('/server/yahoo.ts') : await import('./server/yahoo');
        const headers = new Headers();
        for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v);
        const response: Response = await mod.handleApi(new Request(`http://localhost${req.url}`, { method: req.method, headers }));
        res.statusCode = response.status;
        response.headers.forEach((v, k) => res.setHeader(k, v));
        res.end(await response.text());
      } catch (e) {
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: String(e) }));
      }
    });
  };
  return {
    name: 'artha-api-middleware',
    configureServer: (server) => attach(server as any),
    configurePreviewServer: (server) => attach(server as any),
  };
}

export default defineConfig({
  plugins: [react(), apiMiddleware()],
  build: { target: 'es2020', sourcemap: false, chunkSizeWarningLimit: 900 },
  server: { port: 5173, strictPort: true },
  preview: { port: 4173, strictPort: true },
});
