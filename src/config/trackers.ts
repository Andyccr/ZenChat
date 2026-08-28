/**
 * Public WebTorrent WebSocket trackers used as WebRTC signalling.
 * Prefer wss:// only — GitHub Pages is a secure context and mixed-content
 * ws:// trackers will be blocked.
 *
 * Source of truth: https://github.com/ngosang/trackerslist
 */
export const TORRENT_TRACKERS = [
  'wss://tracker.webtorrent.dev',
  'wss://tracker.openwebtorrent.com',
  'wss://open.ftorrent.com:443',
] as const

/**
 * Public Nostr relays used as an alternate signalling strategy.
 * Same app API, different bootstrap network — useful when trackers are
 * unreachable from a given ISP or region.
 */
export const NOSTR_RELAYS = [
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.snort.social',
  'wss://nostr.wine',
] as const
