import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],

  // ⬇ Dev-Server nur für Entwicklung
  server: {
    port: 5173,
    strictPort: true,
    // API-Proxies für verschiedene Server
    proxy: {
      // Situationsanalyse-API direkt zum Chatbot-Server (Port 3100)
      '/api/situation': {
        target: 'http://localhost:3100',
        changeOrigin: true,
      },
      // Alle anderen API-Routen zum Haupt-Server (Port 4040)
      '/api': {
        target: 'http://localhost:4040',
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
