import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import { resolve } from 'path';

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        external: ['macadam', 'grandiose'],
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer'),
      },
    },
    build: {
      rollupOptions: {
        input: {
          control: resolve(__dirname, 'src/renderer/control/index.html'),
          template: resolve(__dirname, 'src/renderer/template/index.html'),
          rgb: resolve(__dirname, 'src/renderer/output/rgb.html'),
          alpha: resolve(__dirname, 'src/renderer/output/alpha.html'),
        },
      },
    },
  },
});
