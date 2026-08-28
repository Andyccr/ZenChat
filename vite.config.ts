import { copyFileSync, existsSync } from 'node:fs'
import { defineConfig } from 'vitest/config'

const pagesBase = process.env.GITHUB_PAGES === 'true' ? '/ZenChat/' : '/'

export default defineConfig({
  base: pagesBase,
  build: {
    target: 'es2022',
    sourcemap: true,
  },
  plugins: [
    {
      name: 'spa-github-pages-fallback',
      closeBundle() {
        if (existsSync('dist/index.html')) {
          copyFileSync('dist/index.html', 'dist/404.html')
        }
      },
    },
  ],
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
