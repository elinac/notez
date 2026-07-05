import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config';

export default mergeConfig(
  viteConfig as any,
  defineConfig({
    test: {
      environment: 'jsdom',
      globals: true,
    },
  })
);