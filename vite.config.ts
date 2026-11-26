import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  build: { outDir: 'dist', sourcemap: false },
  server: { host: '0.0.0.0', allowedHosts: ['.prod-runtime.all-hands.dev', 'localhost'] },
  preview: { host: '0.0.0.0', allowedHosts: ['.prod-runtime.all-hands.dev', 'localhost'] },
});
