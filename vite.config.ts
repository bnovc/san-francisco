import { defineConfig, Plugin } from 'vite';
import path from 'node:path';
import fs from 'node:fs';

// Dev-only: serve reference photos from /refs (they are NOT part of the shipped build).
function refsMiddleware(): Plugin {
  const root = path.resolve(import.meta.dirname, 'refs');
  const types: Record<string, string> = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.md': 'text/markdown' };
  return {
    name: 'refs-static', apply: 'serve',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url?.startsWith('/refs/')) return next();
        const p = path.join(root, decodeURIComponent(req.url.slice(6).split('?')[0]));
        if (!p.startsWith(root) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.statusCode = 404; res.end(); return; }
        res.setHeader('Content-Type', types[path.extname(p)] || 'application/octet-stream');
        fs.createReadStream(p).pipe(res);
      });
    },
  };
}

export default defineConfig({
  plugins: [refsMiddleware()],
  build: { target: 'es2022', chunkSizeWarningLimit: 4000, rollupOptions: { output: { manualChunks: (id: string) => (id.includes('node_modules/three') ? 'three' : undefined) } } },
  assetsInclude: ['**/*.glb'],
});
