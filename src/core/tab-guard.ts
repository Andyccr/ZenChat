export function watchDuplicateTab(onDuplicate: () => void): () => void {
  if (typeof BroadcastChannel === 'undefined') return () => undefined
  const channel = new BroadcastChannel('zenchat.tab')
  const onMessage = (event: MessageEvent<unknown>) => {
    if (event.data === 'ping') channel.postMessage('pong')
    if (event.data === 'pong') onDuplicate()
  }
  channel.addEventListener('message', onMessage)
  channel.postMessage('ping')
  return () => {
    channel.removeEventListener('message', onMessage)
    channel.close()
  }
}
