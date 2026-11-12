import { viteSingleFile } from 'vite-plugin-singlefile';

// `npm run build` produces ONE self-contained dist/index.html you can double-click.
export default {
  plugins: [viteSingleFile()],
  build: { target: 'esnext', chunkSizeWarningLimit: 4000 },
  esbuild: { target: 'esnext' },
  optimizeDeps: { esbuildOptions: { target: 'esnext' } },
};
