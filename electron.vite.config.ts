import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import { resolve } from 'path';

export default defineConfig({
  main: {
    plugins: [
      externalizeDepsPlugin({
        exclude: ['electron-store', 'uuid'],
      }),
    ],
    build: {
      rollupOptions: {
        external: ['macadam', 'grandiose'],
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/preload/index.ts'),
          output: resolve(__dirname, 'src/preload/output.ts'),
        },
      },
    },
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
