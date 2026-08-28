import { copyFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const rootDir = fileURLToPath(new URL('.', import.meta.url))
const pagesBase = process.env.GITHUB_PAGES === 'true' ? '/ZenChat/' : '/'

export default defineConfig({
  root: fileURLToPath(new URL('./src', import.meta.url)),
  publicDir: fileURLToPath(new URL('./public', import.meta.url)),
  envDir: rootDir,
  base: pagesBase,
  build: {
    target: 'es2022',
    sourcemap: false,
    outDir: fileURLToPath(new URL('./dist', import.meta.url)),
    emptyOutDir: true,
  },
  plugins: [
    {
      name: 'spa-github-pages-fallback',
      closeBundle() {
        const index = fileURLToPath(new URL('./dist/index.html', import.meta.url))
        const fallback = fileURLToPath(new URL('./dist/404.html', import.meta.url))
        if (existsSync(index)) copyFileSync(index, fallback)
      },
    },
  ],
  test: {
    environment: 'node',
    root: rootDir,
    include: ['src/**/*.test.ts'],
  },
})
