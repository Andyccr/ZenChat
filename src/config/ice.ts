/**
 * Public STUN servers only. TURN requires credentials that cannot be
 * safely minted from a purely static GitHub Pages deployment.
 * Symmetric NAT / CGNAT users may fail to connect without TURN.
 */
export const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' },
  { urls: 'stun:stun.l.google.com:19305' },
]

export const RTC_CONFIG: RTCConfiguration = {
  iceServers: ICE_SERVERS,
  iceCandidatePoolSize: 4,
}
