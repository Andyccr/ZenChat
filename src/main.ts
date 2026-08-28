import { App } from './ui/app'
import { bindVisualViewport } from './ui/viewport'
import { preloadStrategies } from './core/transports/trystero'
import './ui/styles.css'

const root = document.querySelector('#app')
if (!root) {
  throw new Error('缺少 #app 挂载点')
}

bindVisualViewport()
preloadStrategies()
new App(root as HTMLElement).start()
