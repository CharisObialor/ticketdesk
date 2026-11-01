import path from 'node:path';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// In development Vite serves the UI on :3000 and proxies API + websocket traffic to the Node server on :8000.
// `npm run build` writes the production bundle to ../public, which the Node server serves.
// When the API runs on its own address, the browser opens the connection to it while the page is still loading,
// so the first request (the session check) does not wait for it.
function preconnectApi(apiUrl: string): Plugin {
  return {
    name: 'preconnect-api',
    transformIndexHtml: () => (apiUrl ? [{ tag: 'link', attrs: { rel: 'preconnect', href: apiUrl, crossorigin: 'use-credentials' }, injectTo: 'head-prepend' }] : []),
  };
}

export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss(), preconnectApi(loadEnv(mode, process.cwd(), 'VITE_').VITE_API_URL ?? '')],
  resolve: { alias: { '@': path.resolve(import.meta.dirname, './src') } },
  server: {
    port: 3000,
    strictPort: true,
    proxy: {
      '/api': 'http://localhost:8000',
      '/socket.io': { target: 'http://localhost:8000', ws: true },
    },
  },
  build: {
    outDir: '../public',
    emptyOutDir: true,
    chunkSizeWarningLimit: 900,
  },
}));
