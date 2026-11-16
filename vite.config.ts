import { defineConfig } from 'vite';

// base './' so the built files also load from file:// inside Electron.
export default defineConfig({
  base: './',
});
