# CF-Pages-SingBoxSH

一个极简的 **Sing-box 一键安装命令生成器**（纯静态网页，无需构建）。

把 [eooce（老王）](https://github.com/eooce) 的 **sing-box 小钢炮** 无交互一键安装脚本的参数，变成几个点选，方便大家使用。本网页是 [cmliu](https://github.com/cmliu) 对该脚本的**拓展 / 二次开发**，仅做参数拼接与可视化，不改变脚本本身的行为。

打开页面只有一个入口：点「添加节点」勾选你想要的节点，底部会实时生成一条可复制的**无交互一键安装命令**，粘到 VPS 上以 root 身份运行即可。不用手工填任何参数，也不会一上来就把一堆配置项铺满屏幕。

## 本地预览

直接双击打开 `index.html` 即可（零依赖、不发任何网络请求、不加载任何第三方资源；`style.css` / `core.js` / `app.js` 都是本地文件）。或在目录下起一个静态服务器：

```bash
python -m http.server 8080
# 然后访问 http://localhost:8080
```

> 注意：脚本必须用普通 `<script src>` 引入（**不能**用 `type="module"`），否则用 `file://` 双击打开会因 CORS 白屏。

## 文件结构

| 文件 | 职责 |
| --- | --- |
| `index.html` | 页面结构 + 本地资源引入（只留结构与引入，不含内联 CSS/JS） |
| `style.css` | 全部样式 |
| `core.js` | **纯逻辑层**：状态构造、端口 / UUID 校验、随机取值、命令拼装。无副作用、不依赖 DOM，可被 Node 直接 `require` |
| `app.js` | **界面层**：渲染、事件、持久化、主题、复制 |

## 生成的命令长什么样

例如全部节点开启、Argo 使用固定隧道并填写了 CF 优选：

```bash
UUID=b7e4b1f0-3c2a-4d9e-8f11-2a3b4c5d6e7f CFIP=mfa.gov.ua CFPORT=443 HY2_PORT=20100 TUIC_PORT=20200 REALITY_PORT=20300 S5_PORT=20400 ANYTLS_PORT=20500 ANYREALITY_PORT=20600 ARGO_PORT=8001 ARGO_DOMAIN=argo.example.com ARGO_AUTH='tok' bash <(curl -Ls https://main.ssss.nyc.mn/sb.sh)
```

### 变量输出顺序（固定）

```
UUID → CFIP → CFPORT → HY2_PORT → TUIC_PORT → REALITY_PORT → S5_PORT → ANYTLS_PORT → ANYREALITY_PORT → ARGO_PORT → ARGO_DOMAIN → ARGO_AUTH → DISABLE_ARGO
```

- `UUID` 永远排在最前面，输出为 `UUID=<值>`（不加引号）。
- `CFIP` / `CFPORT`（「基础配置」组）仅 **Argo 启用时**出现，排在 `UUID` 之后、第一个 `*_PORT` 之前；两个都留空则不输出。
- 选中某协议 = 输出它的端口变量；不选则完全不输出。
- `ARGO_PORT` / `ARGO_DOMAIN` / `ARGO_AUTH` 仅在 Argo 启用时出现，位于 6 个直连端口之后。
- Argo 默认安装；删除 Argo 会追加 `DISABLE_ARGO=true`（恒在末位）。
- `ARGO_AUTH` 用英文单引号包裹并按 `'\''` 转义内部单引号；隧道域名 / 密钥留空即使用临时隧道。

## 变量清单

| 变量 | 含义 | 说明 |
| --- | --- | --- |
| `UUID` | 所有节点的全局鉴权标识 | 标准 UUID（8-4-4-4-12 十六进制）；页面会预填一个随机 UUIDv4，留空自动重新生成 |
| `CFIP` | CF 优选域名 / IP | 仅 Argo 启用时输出；留空则不输出（脚本自带默认值） |
| `CFPORT` | CF 节点对外端口 | 仅 Argo 启用时输出；留空则不输出（脚本自带默认值）；填写时必须为 1–65535 整数 |
| `HY2_PORT` | hysteria2 端口 | 直连 |
| `TUIC_PORT` | tuic-v5 端口 | 直连 |
| `REALITY_PORT` | vless-reality 端口 | 直连 |
| `S5_PORT` | socks5 端口 | 直连 |
| `ANYTLS_PORT` | anytls 端口 | 直连 |
| `ANYREALITY_PORT` | anyreality 端口 | 直连 |
| `ARGO_PORT` | Argo 端口 | 默认 `8001`；留空则不输出（脚本用默认值） |
| `ARGO_DOMAIN` | Argo 固定隧道域名 | 与密钥同时填写才生效，否则用临时隧道 |
| `ARGO_AUTH` | Argo 隧道密钥（token 或 json） | 英文单引号包裹 |
| `DISABLE_ARGO` | 不安装 Argo | 删除 Argo 时输出 `true`，恒在末位 |

## 参数组

- **基础配置**（Argo 启用时）：`CFIP` 优选域名 / IP、`CFPORT` 节点端口。两项均**留空即不输出**，由脚本用默认值兜底。`CFIP` 会去除换行 / 制表符并 trim；`CFPORT` 若填写则必须是 1–65535 的整数。`CFPORT` 是 CF 节点**对外**端口，**不参与本地监听端口冲突检测**。
- **端口**：各直连协议与 Argo 的本地监听端口。
- **固定隧道**（Argo，可选）：`ARGO_DOMAIN` + `ARGO_AUTH`，两项需同时填写，否则使用临时隧道。

## 端口 / UUID 校验与提示

- **端口**：必须是 **1–65535 的整数**。`1` 与 `65535` 合法；`0`、`65536`、负数、小数、非数字、含空格（如 `"10000 "`、`" 10000"`）一律非法。
  - 严格性：**不做 trim** —— 含空格即视为非法。
  - 端口输入框内嵌一个**随机图标按钮**（骰子）：点击即为该输入框随机一个端口，取值范围 **10000–65535**，并会自动避开当前已被占用的端口。`CFPORT` **不提供**随机按钮（它必须是 CF 支持的端口）。
  - 端口重复（含 `ARGO_PORT`）或越界会标红并禁用复制。
- **UUID**：必须是标准 8-4-4-4-12 十六进制（大小写均可，接受任意版本位）。格式非法时输入框标红、给出中文提示并禁用复制。留空会自动生成一个随机 UUIDv4 并回填。
- **错误提示**：端口 / UUID 的错误信息以**独立错误行**呈现（仅在有错误时出现、无错误时不占高度），显示中文原因（如「端口与 Argo 重复」「端口超出有效范围」），避免输入框标红却看不出原因。

## 停止命令

页面在安装命令下方提供一个独立的「停止命令」，内容逐字符为：

```bash
pkill -f '\.tmp/'
```

它是静态的、与节点配置无关，永远可独立复制。

## 主题

- 只保留**浅色 / 深色**两种主题，右上角为图标按钮（浅色显示太阳、深色显示月亮）。
- **首次进入**按系统主题（`prefers-color-scheme`）自动选择；此后用户手动切换的结果会写入 localStorage 并优先使用。
- 传输分类气泡分色：UDP（hysteria2 / tuic-v5）一色系、TCP（vless-reality / socks5 / anytls / anyreality）另一色系、Argo 用中性第三色。

## 持久化

- UUID、各节点配置（含 `CFIP` / `CFPORT`）、主题会静默保存在浏览器本地，刷新不丢失，右上角可「重置」。

## 部署

把 `index.html`、`style.css`、`core.js`、`app.js` 一起放到 Cloudflare Pages 即可（无需构建步骤）。

## 说明

- 页面不展示、也不会生成哪吒监控、订阅等变量。
- 不发任何网络请求、不加载任何第三方资源；页脚里的链接只是供用户点击跳转的超链接。

## 致谢

- 脚本来源：[eooce（老王）](https://github.com/eooce) 的 sing-box 小钢炮脚本。
- 本仓库：[cmliu/CF-Pages-SingBoxSH](https://github.com/cmliu/CF-Pages-SingBoxSH)。

## 免责声明

仅供学习研究使用，请于 24 小时内删除，使用者需自行遵守所在地法律法规。
