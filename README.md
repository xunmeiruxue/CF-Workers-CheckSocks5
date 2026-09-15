# CF-Workers-CheckSocks5

![demo](./demo.png)

一个基于 Cloudflare Workers 的代理可用性检测工具。项目以单个 `_worker.js` 运行为核心，支持 SOCKS5、HTTP、HTTPS、TURN、SSTP 代理检测，提供网页端单条/批量检测、域名解析、出口 IP 信息展示、地图定位、结果筛选与导出。

本仓库是 [cmliu/CF-Workers-CheckSocks5](https://github.com/cmliu/CF-Workers-CheckSocks5) 的增强版，在上游代码零改动的前提下加了一层包装：

- **新增：订阅链接一键检测** —— 粘贴一个订阅链接，自动抓取其全部 SOCKS5 / HTTP / HTTPS / TURN / SSTP 节点并开始批量检测，不用再手动复制粘贴节点。
- **上游代码零改动** —— 上游 `_worker.js` 原样放在 `upstream/`，由 GitHub Actions 每天自动同步；本仓库的改动全部在 `src/` 下，因此永远不会和上游产生冲突。
- **自动部署** —— 密钥从 1Password Environment 读取，推送到 `main` 即自动部署到 Cloudflare Workers。


> 当前源码没有内置 `TOKEN` 鉴权。部署到公开域名后，任何访问者都可以使用检测接口；如果需要私有使用，请在 Cloudflare 侧增加访问控制或自行扩展鉴权逻辑。

## 功能特性

- 支持 `socks5://`、`http://`、`https://`、`turn://`、`sstp://` 五类代理协议。
- 支持无认证代理、`username:password` 认证代理，以及 IPv4、域名、方括号 IPv6 地址。
- TURN 检测使用 TCP Allocation / CONNECT / ConnectionBind 流程，支持无认证 TURN 服务器和长期凭据认证。
- SSTP 检测使用 HTTPS SSTP 握手、PPP / IPCP 建链，并通过 PPP 内 TCP 连接读取出口信息。
- 支持单条检测和批量检测；批量模式会自动去重、解析域名并并发验证。
- 支持域名解析为 A / AAAA 记录，优先使用 Cloudflare DoH，失败后回退到 Google DoH。
- 支持代理出口信息展示，包括出口 IP、地区、ASN、运营商、风险标签、响应耗时等。
- 支持 Leaflet / OpenStreetMap 地图展示出口位置。
- 支持结果筛选，并可将有效结果复制到剪贴板或导出为 TXT / CSV。
- 支持深浅色主题、历史记录、访问人数显示和自定义页脚备案内容。
- 支持粘贴订阅链接自动抓取节点（明文 / Base64 / Clash YAML / sing-box / Xray 五类订阅格式）。
- 支持 `?sub=<订阅链接>` 直接打开页面即自动抓取并检测。

## 在线体验

Demo: <https://check.socks5.cmliussss.net>

## 部署方式

只支持 **Cloudflare Workers**（不支持 Pages）：入口是 `src/index.js`，它 import 的 `upstream/_worker.js` 是上游源码。

### 方式一：GitHub Actions 自动部署（推荐）

仓库自带的 `.github/workflows/deploy.yml` 会从 1Password 读取 Cloudflare 令牌并执行 `wrangler deploy`。一次性准备：

1. 1Password 建一个 Service Account，勾选 `edgetunnel` Environment 的 **Read** 权限，把 token 存成本仓库 secret `OP_SERVICE_ACCOUNT_TOKEN`。
2. 确认该 Environment 里有 `cloudflare` 变量（Cloudflare API 令牌）。
3. 令牌需要两个权限：`Account Settings: Read` + `Workers Scripts: Edit`。

> 原来给 Pages 用的令牌只有 `Cloudflare Pages: Edit`，**没有** Workers 权限，直接拿来部署会报 10000 / 9106 之类的认证错误。给现有令牌补上 `Workers Scripts: Edit` 即可，也可以按下面的链接新建：

```text
https://dash.cloudflare.com/profile/api-tokens?permissionGroupKeys=%5B%7B%22key%22%3A%22account_settings%22%2C%22type%22%3A%22read%22%7D%2C%7B%22key%22%3A%22workers_scripts%22%2C%22type%22%3A%22edit%22%7D%5D&accountId=*&zoneId=all&name=CheckSocks5%20Workers%20Deploy
```

准备好之后，推送到 `main` 就会自动部署；也可以在 Actions 页面手动触发 `Deploy to Cloudflare Workers`。

### 方式二：本地 wrangler 部署

```bash
npm install -g wrangler@4
wrangler login                      # 或设置 CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID
wrangler deploy                     # 读取仓库根的 wrangler.toml
```

部署完成后访问 `https://cf-workers-check-socks5.<你的子域>.workers.dev` 即可。换 Worker 名或绑定自定义域，改 `wrangler.toml` 里的 `name` / `routes`。

### 上游代码缺失时

`upstream/_worker.js` 由同步工作流维护。如果它缺失或需要立即刷新，执行一次 `Actions → Upstream Sync → Run workflow` 即可；本地也可以先 `git fetch upstream main`，再 `git show FETCH_HEAD:_worker.js | node tools/sync-upstream.mjs upstream/_worker.js`。

## 环境变量

当前源码只读取以下环境变量：

| 变量名 | 说明 | 示例 | 必需 |
| --- | --- | --- | --- |
| `BEIAN` | 自定义页面页脚 HTML。未设置时使用默认页脚，包含项目链接、访问人数和维护者链接。 | `© 2026 Example.com · ICP 备案号` | 否 |

本仓库新增的订阅相关变量，同样都可以不配置：

| 变量名 | 默认值 | 说明 |
| --- | --- | --- |
| `SUBSCRIPTION_UA` | `v2rayN/6.0` | 抓订阅时使用的 User-Agent，部分订阅站会按 UA 返回不同格式 |
| `SUBSCRIPTION_LIMIT` | `1500` | 单次订阅最多返回的节点数，避免一次塞进上万个节点 |
| `SUBSCRIPTION_DISABLED` | 未设置 | 设为 `1` 时关闭订阅抓取接口与页面区块 |

> 变量可以在 Cloudflare 面板的 Worker 设置里加，`wrangler.toml` 里带了 `keep_vars = true`，重新部署不会清掉面板上设的变量；也可以用 `wrangler secret put`。

## 支持的代理格式

```text
socks5://host:1080
socks5://username:password@host:1080
socks5://username:password@[2001:db8::1]:1080
http://host:80
http://username:password@host:80
https://host:443
https://username:password@host:443
turn://host:3478
turn://username:password@host:3478
sstp://host:443
sstp://username:password@host:443
```

网页端输入缺少协议头时，会默认按 `socks5://` 处理。端口缺省值分别为：

| 协议 | 默认端口 |
| --- | --- |
| `socks5` | `1080` |
| `http` | `80` |
| `https` | `443` |
| `turn` | `3478` |
| `sstp` | `443` |

### TURN 支持说明

`turn://` 目标会被当作 TURN over TCP 服务器检测。Worker 会先连接 TURN 服务器，再通过 TURN TCP 中继访问 `www.iplocate.io:443`，最后读取出口 IP 信息。

当前 TURN 实现有以下边界：

- 支持 RFC 6062 风格的 TCP Allocation、CreatePermission、CONNECT 和 ConnectionBind。
- 支持无认证服务器；如果服务端返回 `401` 认证挑战，并且链接中提供了 `username:password`，会使用长期凭据认证继续握手。
- 目标出口检测地址会解析为 IPv4 后发起 TURN CONNECT；当前不走 TURN UDP relay，也不支持 `turns://`。
- `turn://` 中的主机可以是 IP 或域名，端口未填写时默认使用 `3478`。

### SSTP 支持说明

`sstp://` 目标会被当作 SSTP over TLS 服务器检测。Worker 会先建立 SSTP HTTP 隧道，再完成 PPP / IPCP 协商，随后在 PPP 内构造 TCP 连接访问 `www.iplocate.io:443`，最后读取出口 IP 信息。

当前 SSTP 实现有以下边界：

- 支持无认证 SSTP 服务器；如果 PPP 协商要求认证，仅支持 PAP，并使用链接中提供的 `username:password`。
- 目标出口检测地址会解析为 IPv4 后建立 PPP 内 TCP 连接；当前 SSTP 检测依赖服务端分配 IPv4 地址。
- `sstp://` 中的主机可以是 IP 或域名，端口未填写时默认使用 `443`。

## API

所有 JSON 接口都带有 CORS 响应头，并支持 `OPTIONS` 预检请求。

### `GET /check`

检测单个代理是否可用。Worker 会通过代理建立到 `www.iplocate.io` 的连接，并读取该服务返回的出口 IP 信息。

请求参数支持以下写法：

```text
/check?socks5=proxy.example.com:1080
/check?http=proxy.example.com:80
/check?https=proxy.example.com:443
/check?turn=turn.example.com:3478
/check?sstp=vpn:vpn@vpn205396913.opengw.net:1922

/check?proxy=socks5://user:pass@proxy.example.com:1080
/check?proxy=http://proxy.example.com:80
/check?proxy=https://proxy.example.com:443
/check?proxy=turn://user:pass@turn.example.com:3478
/check?proxy=sstp://vpn:vpn@vpn890321947.opengw.net:1630
/check/proxy=socks5://proxy.example.com:1080
```

响应示例：

```json
{
  "candidate": "proxy.example.com:1080",
  "type": "socks5",
  "username": null,
  "password": null,
  "hostname": "proxy.example.com",
  "port": 1080,
  "link": "socks5://proxy.example.com:1080",
  "success": true,
  "responseTime": 523,
  "exit": {
    "ip": "203.0.113.10",
    "rir": "APNIC",
    "is_datacenter": true,
    "is_proxy": false,
    "is_vpn": false,
    "asn": {
      "asn": 64500,
      "org": "Example Network"
    },
    "location": {
      "country": "Japan",
      "country_code": "JP",
      "city": "Tokyo",
      "latitude": 35.6895,
      "longitude": 139.6917
    }
  }
}
```

失败时会返回 `success: false` 和 `error` 字段。

### `GET /resolve`

将域名或代理链接解析为可检测的 `host:port` 列表。

参数别名：

- `proxyip`
- `target`
- `host`

示例：

```bash
curl "https://your-worker.example.workers.dev/resolve?proxyip=socks5://proxy.example.com:1080"
```

响应示例：

```json
[
  "198.51.100.10:1080",
  "[2001:db8::10]:1080"
]
```

解析规则：

- 输入已经是 IPv4 或 IPv6 时，直接返回原目标和端口。
- 输入是域名时，解析 A / AAAA 记录。
- 未提供端口时，解析接口默认使用 `443`。

### `POST /resolve-batch`

批量解析目标。单次最多 `50` 个。

请求体支持 `targets` 或 `proxyips`：

```json
{
  "targets": [
    "socks5://proxy-a.example.com:1080",
    "proxy-b.example.com:1080"
  ]
}
```

响应示例：

```json
{
  "results": [
    {
      "input": "proxy-b.example.com:1080",
      "targets": [
        "198.51.100.20:1080"
      ]
    }
  ]
}
```

## 订阅链接模式

这是本仓库相对上游新增的能力：不用再把节点一条条复制进输入框。

1. 打开部署后的 Worker 域名。
2. 在「订阅链接」输入框里粘贴订阅地址，回车或点「抓取并检测」。
3. 后端抓取订阅、提取节点、自动切到「批量检测」、把节点填进输入框并开始检测；结果渲染、筛选、导出全部复用上游逻辑。

细节说明：

- 识别 **明文列表 / Base64 / Clash(mihomo) YAML / sing-box JSON / Xray(v2ray) JSON** 五类订阅格式。
- 只提取本项目能检测的 `socks5` / `http` / `https` / `turn` / `sstp` 节点；`vmess` / `vless` / `trojan` / `ss` 等会计数并跳过，页面提示跳过了多少个。
- 明文订阅里的 `http` / `https` 链接必须带端口才算代理节点，避免把订阅里的官网地址当节点（需要放开用 `web=1`）。
- 内网与保留地址（127.x、10.x、192.168.x、169.254.x 等）不会被抓进来，订阅结果缓存 60 秒。

也可以带参数直接打开页面，加载后自动抓取并检测：

```text
https://your-worker.example.workers.dev/?sub=https://sub.example.com/vpngate
```

### `GET / POST /subfetch`

抓取订阅并返回可检测节点列表，参数支持 query 或 JSON body：

| 参数 | 说明 | 默认 |
| --- | --- | --- |
| `url` | 订阅链接，必填（缺少协议头会按 `https://` 补全） | - |
| `ua` | 抓订阅用的 User-Agent | `v2rayN/6.0` |
| `limit` | 最多返回的节点数 | `1500` |
| `web=1` | 把无端口的 `http(s)` 链接也当节点 | 关闭 |
| `nocache=1` | 跳过 60 秒缓存 | 关闭 |

```bash
curl -X POST https://your-worker.example.workers.dev/subfetch \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://sub.example.com/vpngate"}'
```

响应（截断）：

```json
{
  "ok": true,
  "format": "plain",
  "count": 73,
  "total": 73,
  "truncated": false,
  "targets": ["sstp://user:pass@vpn-node-1.example.net:443"],
  "schemeCounts": { "sstp": 73 },
  "unsupported": {},
  "bytes": 3817,
  "elapsedMs": 320
}
```

## 网页端使用

1. 打开部署后的 Worker 域名。
2. 在输入框中填写代理链接、`IP:端口`、`域名:端口` 或带认证的代理地址。
3. 如需批量检测，打开「批量检测」并粘贴多行目标。
4. 点击「开始检测」。
5. 检测完成后，可按全部/有效/失败/风控评级、协议和国家地区筛选，并导出有效结果。

也可以直接通过路径触发单条检测：

```text
https://your-worker.example.workers.dev/socks5://proxy.example.com:1080
```

## 运行参数

源码中的主要限制和超时：

| 参数 | 当前值 | 说明 |
| --- | --- | --- |
| `CHECK_TIMEOUT_MS` | `12000` | 单次代理检测总超时 |
| `CONNECT_TIMEOUT_MS` | `9999` | 代理连接和握手超时 |
| `READ_TIMEOUT_MS` | `8000` | 读取远端响应超时 |
| `MAX_RESPONSE_BYTES` | `96 KiB` | 读取出口信息响应的最大字节数 |
| `RESOLVE_BATCH_LIMIT` | `50` | 批量解析接口单次最大目标数 |
| 前端检测并发 | `32` | 网页端批量检测的并发数 |
| `DEFAULT_TARGET_LIMIT`（src） | `1500` | `/subfetch` 单次返回的节点上限 |
| `DEFAULT_TIMEOUT_MS`（src） | `15000` | 抓取订阅的超时 |
| `MAX_SUBSCRIPTION_BYTES`（src） | `4 MiB` | 订阅响应体大小上限 |

## 注意事项

- Cloudflare Workers 的 TCP Socket 能力由 `cloudflare:sockets` 提供，请确保部署环境支持 Workers TCP 出站连接。
- 检测逻辑会把代理作为隧道访问 `www.iplocate.io`，因此结果反映的是该代理访问该目标服务时的可用性和出口信息。
- TURN 检测依赖 TURN 服务器支持 TCP relay / CONNECT；只支持 UDP relay 的 TURN 服务会检测失败。
- SSTP 检测依赖服务端支持 SSTP over TLS、PPP / IPCP 和 IPv4 分配；仅支持 PAP 认证，不支持 MS-CHAP 等其他 PPP 认证方式。
- 公开部署时请谨慎使用真实代理账号密码；当前页面和接口没有访问令牌保护。
- 大批量检测可能受到 Cloudflare Workers 执行时长、并发和外部 DNS/API 可用性的影响。

## 项目结构

```text
upstream/_worker.js      上游原版代码，工作流自动同步，不要手改
upstream/UPSTREAM_REV    当前同步到的上游 commit
src/index.js             入口 Worker：/subfetch 路由 + HTML 注入 + 转发上游
src/subscription.js      订阅抓取与解析（纯逻辑，可单测）
src/client.js            注入到页面的订阅区块脚本
tools/sync-upstream.mjs  同步上游文件并做 ESM 语法校验
.github/workflows/       Upstream Sync + Deploy to Cloudflare Workers
```

## 本地开发与测试

```bash
npx wrangler dev                                          # 本地起服务，默认 http://127.0.0.1:8787
npx wrangler deploy --dry-run --outdir=.wrangler/dry-run  # 只打包不上传
node --test docs/dev-tests/subscription.test.mjs          # 订阅解析层回归测试（本地文件，未提交）
```

## 自动同步上游

本仓库不是 GitHub 意义上的 fork（`fork: false`），网页上没有 Sync fork 按钮，所以 `.github/workflows/sync.yml` 自己用 upstream remote 拉取：

- 每天 UTC 03:00 自动跑，也可以手动触发；只覆盖 `upstream/_worker.js` 和 `upstream/UPSTREAM_REV`。
- 拉下来的文件先过 `node --check` 语法校验，坏文件不会进仓库。
- 有变化才提交；`GITHUB_TOKEN` 的推送不触发 `push` 事件，所以 `deploy.yml` 额外监听 `workflow_run`，同步完成即自动部署。
- 本仓库自己的代码都在 `src/` 下，同步永远不会和上游冲突。

## 许可证

本项目基于 [GNU General Public License v3.0](./LICENSE) 发布。

## 开源代码引用
- [CF-Workers-HTTPS](https://github.com/ToiCF/CF-Workers-HTTPS)
- [CF-Workers-TURN](https://github.com/ToiCF/CF-Workers-TURN)
- [CF-Workers-SoftEther](https://github.com/ToiCF/CF-Workers-SoftEther)

## 致谢
- [@Alexandre_Kojeve](https://t.me/Alexandre_Kojeve)
- [Cloudflare Workers](https://workers.cloudflare.com/)
- [iplocate.io](https://www.iplocate.io/)
- [Cloudflare DNS](https://cloudflare-dns.com/)
- [OpenStreetMap](https://www.openstreetmap.org/)
- [Leaflet](https://leafletjs.com/)
