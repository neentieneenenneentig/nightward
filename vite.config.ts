import { defineConfig } from 'vite';

export default defineConfig({
  // relative base so the built game works from any static host or file path
  base: './',
  server: { host: true, port: 5173, strictPort: true },
  build: { target: 'es2022' },
});
