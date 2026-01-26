import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],

  // ⬇ Dev-Server nur für Entwicklung
  server: {
    port: 5173,
    strictPort: true,
    // Optional: API-Proxy auf deinen Express-Server (http://localhost:4000)
    proxy: {
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
        // falls du Cookies/Auth hast:
        // cookieDomainRewrite: 'localhost'
      }
    }
  },

  // ⬇ Klarer SPA-Build (Vite hat das implizit, wir machen es explizit)
  appType: 'spa',

  build: {
    // 👉 bleibt wie bei dir: Ausgabe direkt in server/dist
    outDir: path.resolve(__dirname, '../server/dist'),
    emptyOutDir: true,
    // optional hilfreich beim Debuggen nach dem Build:
    // sourcemap: true,
  },

  // 👉 bleibt wie bei dir
  publicDir: 'public',
});
