import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: 'src/client',
  plugins: [react()],
  define: {
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
  server: {
    // Онлайн-комнаты (блок G): в разработке API отдаёт Express из npm run dev:server.
    proxy: { '/api': 'http://localhost:3000' },
  },
  build: {
    outDir: '../../dist/client',
    emptyOutDir: true,
  },
});
