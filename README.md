# CF-Pages-SingBoxSH

把 [eooce（老王）](https://github.com/eooce) 的 **sing-box 小钢炮** 无交互一键安装脚本，变成一个网页点选器：勾选节点、复制命令、粘到 VPS 上运行，完事。

先说清楚：**本网页没有对脚本做任何改动**，只是把脚本的参数变成几个点选、帮你拼好命令（我们只是脚本的搬运工）。脚本本身的行为、安装内容与**最终解释权，均归原作者 [eooce（老王）](https://github.com/eooce) 所有**。

## 怎么用

1. **打开页面**：部署到 Cloudflare Pages 后访问；本地用就双击 `index.html`（纯静态、零依赖、不发任何网络请求）。
2. **挑节点**：默认已启用 Argo；点「+ 更多节点协议」勾选想要的，或点「ALL」一键全选（端口自动随机分配、互不冲突）。
3. **复制命令**：点命令区右下角绿色「复制命令」。
4. **上 VPS 运行**：SSH 登录，**以 root 身份**粘贴回车。装完输入 `sb` 调出脚本菜单；想停掉就复制页面上的「停止命令」运行。

生成的命令长这样（无需手写，页面自动拼好）：

```bash
UUID=b7e4b1f0-3c2a-4d9e-8f11-2a3b4c5d6e7f bash <(curl -Ls https://main.ssss.nyc.mn/sb.sh)
```

VPS 要求（来自上游脚本）：Linux，amd64 / arm64 / s390x 架构，已装 `curl` 或 `wget` 任一。

## 部署

把 `index.html`、`style.css`、`core.js`、`app.js` 这 4 个文件放到 Cloudflare Pages 即可（无需构建、无需配置）。

## 致谢

- 脚本来源与最终解释权：[eooce（老王）](https://github.com/eooce) 的 sing-box 小钢炮脚本。
- 本仓库（只是网页壳）：[cmliu/CF-Pages-SingBoxSH](https://github.com/cmliu/CF-Pages-SingBoxSH)。

## 免责声明

仅供学习研究使用，请于 24 小时内删除，使用者需自行遵守所在地法律法规。
