import { cpSync, existsSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const dist = 'dist'
const files = ['index.html', '404.html', 'favicon.svg']

if (!existsSync(join(dist, 'index.html'))) {
  throw new Error('dist/index.html 不存在，请先运行 GITHUB_PAGES=true npm run build')
}

for (const file of files) {
  const from = join(dist, file)
  if (existsSync(from)) cpSync(from, file)
}

rmSync('assets', { recursive: true, force: true })
cpSync(join(dist, 'assets'), 'assets', { recursive: true })
writeFileSync('.nojekyll', '')
console.log('GitHub Pages 静态文件已同步到仓库根目录')
