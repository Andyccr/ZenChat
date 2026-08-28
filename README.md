# ZenChat 禅聊

部署在 GitHub Pages（或其他纯静态托管）上的浏览器 P2P 聊天室。页面本身不含任何后端；房间发现走公共 WebTorrent Tracker 或 Nostr 中继，消息在建立连接后只经过 WebRTC DataChannel。

在线地址（合并并开启 Pages 后）：https://andyccr.github.io/ZenChat/

---

## 1. 技术选型：P2PT vs WebPEER / libp2p

两条路径都能满足「不自建信令服务器」这一约束，但它们解决的问题半径不同。

| | **P2PT / Trystero-torrent（WebTorrent）** | **WebPEER / js-libp2p** |
|---|---|---|
| 信令介质 | 公共 WebSocket Tracker。房间名被映射为 infohash，Tracker 只交换 offer/answer。 | 公共 bootstrap / 中继节点 + Identify / PubSub（或 WebPEER 的 `joinRoom`）。 |
| 连接建立后的数据路径 | 浏览器 ↔ 浏览器 WebRTC DataChannel（DTLS） | 同样是浏览器 WebRTC DataChannel（libp2p 的 `webRTC` transport） |
| 房间模型 | identifier / `appId + roomId` → 同一 swarm | namespace / pubsub topic |
| 浏览器体积与复杂度 | 小，API 面窄，适合「聊天室」这种明确的房间语义 | 大（DHT、muxer、peer routing），接入成本高 |
| 成熟的静态站先例 | [Chitchatter](https://chitchatter.im/)、[P2Chat](https://github.com/subins2000/p2chat)、[Board-IO](https://elvistony.github.io/board-io) | [WebPEER 聊天 demo](https://nuzulul.github.io/webpeerjs/demo/chat.html) |
| 已知限制 | 公共 Tracker 数量少、会宕；对称 NAT 仍需要 TURN（这不是信令问题） | 依赖公共 bootstrap 的可达性；WebPEER 曾有约 1 条/秒的广播限速 |
| 扩展方向 | 换 Tracker 列表、加 Nostr/MQTT 等平行信令策略 | DHT、跨语言节点、Circuit Relay，适合做成通用 P2P 应用平台 |

**推荐：P2PT 这一路，并用 Trystero 的 BitTorrent 策略落地。**

理由：

1. 约束匹配。GitHub Pages 只能发静态文件；WebTorrent Tracker 已经是现成的、与应用无关的信令基础设施，不必也无法在 Pages 上跑 WebSocket 服务。
2. 房间语义天然。一个字符串 identifier 就是一个聊天室，和「输入房间名即可相遇」完全同构。
3. 可替换。把 Tracker 换成 Nostr 中继只改策略模块，上层协议（hello / chat / typing）不动。这比一上来绑死 libp2p 栈更利于演进。
4. 何时再上 libp2p：需要浏览器节点与 Go/Rust 节点组网、内容寻址、或 Circuit Relay 时，再实现同一个 `SignallingTransport` 接口即可。

ZenChat 因此采用：

- 默认信令：`@trystero-p2p/torrent`（P2PT / WebTorrent Tracker）
- 备选信令：`@trystero-p2p/nostr`（公共 Nostr 中继，同一套房间 API）
- 传输：WebRTC DataChannel
- ICE：仅公共 STUN。TURN 需要密钥签发，无法安全地做进纯静态站（见第 3 节）

---

## 2. 核心实现：从初始化到第一条消息

下面是最小可用路径。完整工程把这些步骤拆进 `src/core/transports` 与 `src/core/session.ts`。

### 2.1 用公共 Tracker 发现同一房间的浏览器

```ts
import { joinRoom, selfId } from '@trystero-p2p/torrent'

const room = joinRoom(
  {
    appId: 'zenchat.andyccr.v1',
    relayConfig: {
      urls: [
        'wss://tracker.webtorrent.dev',
        'wss://tracker.openwebtorrent.com',
        'wss://open.ftorrent.com:443',
      ],
    },
    rtcConfig: {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun.cloudflare.com:3478' },
      ],
    },
  },
  'lobby', // 房间名 → swarm / infohash
)

console.log('local peer', selfId)
room.onPeerJoin = (peerId) => console.log('connected', peerId)
```

等价的底层 P2PT 写法（同一条技术路径）：

```js
import P2PT from 'p2pt'

const p2pt = new P2PT(
  ['wss://tracker.webtorrent.dev', 'wss://tracker.openwebtorrent.com'],
  'zenchat.andyccr.v1:lobby',
)
p2pt.on('peerconnect', (peer) => p2pt.send(peer, { type: 'hello', nick: '晚风' }))
p2pt.on('msg', (peer, msg) => console.log(peer.id, msg))
p2pt.start()
```

### 2.2 打开 DataChannel 上的应用协议

```ts
const chat = room.makeAction('zen')

chat.onMessage = (data, { peerId }) => {
  // data 已由库反序列化；ZenChat 再做版本与字段校验
  console.log(peerId, data)
}

await chat.send({ v: 1, type: 'chat', id: 'aa11', ts: Date.now(), nick: '晚风', text: '你好' })
```

定向发给刚加入的节点：

```ts
room.onPeerJoin = async (peerId) => {
  await chat.send({ v: 1, type: 'hello', nick: '晚风' }, { target: peerId })
}
```

### 2.3 应用层约定（本仓库）

- URL：`#/r/房间名?s=torrent|nostr`，可选 `k=` 口令
- 口令参与 swarm 隔离，且交给 Trystero 做 SDP 加密；默认复制链接时不带出口令
- 消息类型：`hello` / `chat` / `typing`，均带协议版本 `v: 1`
- 身份：昵称存 `localStorage`，节点 id 存 `sessionStorage`（刷新同一标签页保持，关标签即换）

---

## 3. 纯静态环境里的坑与对策

| 问题 | 现象 | 对策 |
|---|---|---|
| 必须是安全上下文 | `http://` 非 localhost 下 WebRTC / Crypto 不可用 | 只用 GitHub Pages HTTPS，或 `vite` 的 localhost |
| 项目站的 `base` | `https://user.github.io/ZenChat/` 下脚本 404 | `vite.config.ts` 在 `GITHUB_PAGES=true` 时使用 `/ZenChat/`；hash 路由避免 Pages 对子路径返回 404 |
| Tracker 过少或宕机 | 信令指示灯不亮，永远 0 个节点 | 内置多条 `wss://` Tracker；UI 可切换 Nostr；`getRelaySockets()` 把每个中继的 `readyState` 暴露在状态栏 |
| 对称 NAT / 公司网 / CGNAT | Tracker 已连上，但 DataChannel 起不来 | 这是 ICE 问题不是信令问题。纯静态站**不能**安全内嵌 TURN 密钥。同 Wi-Fi / 家用 NAT 通常可以；跨运营商失败时需自备 TURN，或接受「部分用户连不上」 |
| Safari / iOS | 后台标签页冻结、部分 Tracker 被拦截 | 保持标签页前台；多 Tracker；必要时换 Nostr |
| 全连接 Mesh 规模 | 房间一大，每对浏览器一条 WebRTC，O(n²) | 产品上按房间拆分；浏览器同时连接数有限，这是选「房间」而不是「全球大厅」的原因 |
| 公共信令看见什么 | Tracker / 中继看得到对等节点标识和加密后的 SDP，看不到聊天正文 | 口令房间把 SDP 再加一层；不要把真正的秘密放进房间名 |
| 浏览器刷新 | DataChannel 断开，消息不在服务器上 | 本设计即是瞬时的。不要假设历史会从网上拉回来 |
| CSP / 混合内容 | `ws://` Tracker 被 Pages 的 HTTPS 拦截 | 只使用 `wss://` |
| 依赖体积与 polyfill | 直接引 `p2pt` 时常需要 `Buffer` / `global` polyfill | 用 Trystero 的官方策略包，由 Vite 打包 |

---

## 4. 已部署在 GitHub Pages 上的参考项目

1. **[Chitchatter](https://github.com/jeremyckahn/chitchatter)** — 线上 https://chitchatter.im/  
   完整的无服务器聊天（文字 / 语音 / 文件），信令走 WebTorrent（Trystero），可选 TURN。是目前最接近「GitHub Pages 上的生产级 P2P 聊天」的参考实现。

2. **[WebPEER chat demo](https://nuzulul.github.io/webpeerjs/demo/chat.html)**（源码 [nuzulul/webpeerjs](https://github.com/nuzulul/webpeerjs)）  
   libp2p 路线的最小聊天室，适合对照 `joinRoom` / `broadcast` API。另可看 [Board-IO](https://elvistony.github.io/board-io)（P2PT 白板）作为更轻的 Pages 部署样本。

---

## 本地运行与部署

```bash
npm install
npm test
npm run dev
```

打开两个浏览器窗口，进入同一房间名即可互发。主题按钮在「跟随系统 / 白天 / 黑夜」之间循环。

GitHub Pages：

1. 仓库 Settings → Pages → Source 选 **GitHub Actions**
2. 合并到 `main` 后，`.github/workflows/pages.yml` 会构建并发布 `dist/`
3. 访问 `https://andyccr.github.io/ZenChat/#/r/lobby`

---

## 架构

```
UI (lobby / chat / theme)
        │
        ▼
 ChatSession   应用协议、成员表、去重、心跳
        │
        ▼
 SignallingTransport 接口
   ├─ Trystero torrent   公共 WebTorrent Tracker
   └─ Trystero nostr     公共 Nostr 中继
        │
        ▼
 WebRTC DataChannel  ← 真正的消息通道
```

扩展点：再写一个 `Libp2pTransport implements SignallingTransport`，不必改 UI。

许可：GNU AGPL v3。界面提供源码链接以满足网络交互条款。
