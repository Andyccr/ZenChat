import { copy } from './copy'
import { el } from './dom'

export function webrtcReady(): boolean {
  return typeof RTCPeerConnection === 'function'
}

export function canJoin(): boolean {
  return window.isSecureContext && webrtcReady()
}

export function capabilityBanner(): HTMLElement {
  if (!window.isSecureContext) return el('div', { class: 'banner' }, [copy.insecure])
  if (!webrtcReady()) return el('div', { class: 'banner' }, [copy.webrtcMissing])
  return el('div')
}
