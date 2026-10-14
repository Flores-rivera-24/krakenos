import { fileURLToPath, URL } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const AGENT_URL = process.env.VITE_AGENT_URL ?? 'http://localhost:3001';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: { manifest: true },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': { target: AGENT_URL, changeOrigin: true },
      '/health': { target: AGENT_URL, changeOrigin: true },
      '/socket.io': { target: AGENT_URL, ws: true, changeOrigin: true },
    },
  },
});
