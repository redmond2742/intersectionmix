import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // three.js loads only with the 3D view, as its own chunk; it is big by nature.
  build: { chunkSizeWarningLimit: 800 },
  test: {
    include: ['tests/**/*.test.mjs'],
    environment: 'node',
  },
});
