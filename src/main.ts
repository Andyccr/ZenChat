import { App } from './ui/app'
import './ui/styles.css'

const root = document.querySelector('#app')
if (!root) {
  throw new Error('缺少 #app 挂载点')
}

new App(root as HTMLElement).start()
