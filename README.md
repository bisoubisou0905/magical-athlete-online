# 魔法运动会 Online

一款面向手机浏览器的 2–4 人线上混乱赛跑游戏。游戏依据提供的《How to play MAGICAL ATHLETE》规则书制作，使用 Three.js 呈现立体赛道，并通过 WebRTC 实现无需自建游戏服务器的房间联机。

## 现在可以玩什么

- 6 位房间码创建/加入 2–4 人动态房间
- 房主可逐个添加或移除 AI，真人与电脑任意组合
- 两轮蛇形选秀，每人招募 4 名角色
- 秘密选择角色，连续进行 4 局比赛
- Mild / Wild 赛道交替；Wild 包含箭头、石头和星星
- 36 名角色及其主要能力、连锁触发、绊倒、传送、淘汰和精确冲线
- 36 张规则书原画角色纹理：选秀卡面、比赛 HUD 与 Three.js 纸板立牌统一呈现
- 递增奖杯计分与并列获胜
- 单人添加 1–3 名电脑的快速试玩模式
- 可安装 PWA 与手机竖屏布局
- 房主权威规则判定和共享赛事日志

## 免费联机方案

静态客户端部署在 GitHub Pages。PeerJS Cloud 免费提供 WebRTC 信令；建立连接后，客人把操作发送给房主，房主执行规则并广播权威状态。

这个方案适合免费原型和小规模测试，但有两个限制：

1. 房主必须保持页面在线；房主离开后本局结束。
2. 少数严格 NAT / 企业网络可能阻止点对点连接。正式商业版建议部署自己的 PeerServer/TURN，并增加持久化房间服务。

## 本地运行

需要 Node.js 22 和 pnpm 11。

```bash
pnpm install
pnpm dev
```

打开终端显示的本地网址。房主可以逐个添加 AI，最少 2 名选手即可开始。

## 验证

```bash
pnpm test
pnpm build
pnpm preview
```

测试包含：36 名角色数据完整性、动态 2–4 人蛇形选秀、四局完整自动模拟、秘密选角网络视图。项目也已在四个独立浏览器标签页中验证房间加入与选秀同步，并在 390×844 手机视口检查纵向赛道、原画立牌和 HUD 布局。

## GitHub Pages

推送到 `main` 后，`.github/workflows/deploy.yml` 会自动测试、构建并部署。首次使用时，在仓库 **Settings → Pages → Build and deployment** 将 Source 设为 **GitHub Actions**。

## 代码结构

- `src/game/`：纯 TypeScript 规则、状态和角色数据
- `src/network/`：PeerJS 房间、房主权威动作与玩家视图
- `src/three/`：Three.js 赛道与角色棋子
- `src/ui/`：大厅、选秀、选角、比赛和结算 UI

更多边界说明见 [ARCHITECTURE.md](docs/ARCHITECTURE.md)，视觉规范见 [ART_DIRECTION.md](docs/ART_DIRECTION.md)。

## 内容说明

仓库不包含完整规则书 PDF，只包含由项目方提供并明确要求用于本游戏的 36 张角色卡面局部纹理。发布前请确保这些角色插画的数字发行权覆盖网页游戏和公开仓库。
