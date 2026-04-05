# TeleChat-Link

一个部署在 Cloudflare Workers 上的双向桥接服务：

- TeleChat（主聊天平台）用户发消息给机器人
- Worker 转发给 Telegram 管理员
- 同时同步摘要到飞书
- 你可以在飞书里回复，把消息回发给原 Telegram 用户
- 你也可以在 Telegram 管理员私聊里直接 回复 用户消息

> 说明：代码表层统一使用 **TeleChat** 命名。底层主聊天平台 API 仍然使用官方 Bot API 域名，这是不可避免的实现细节。

---

## 一键部署

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/L-aros/TeleChat-Link)

点击按钮后，Cloudflare 会基于这个仓库创建你的 Worker。部署完成后，请到 Worker 后台手动补齐变量和密钥：

- 进入 `Workers & Pages` -> 你的 Worker -> `Settings` -> `Variables and Secrets`
- 手动添加下列 secrets：
  - `TELECHAT_BOT_TOKEN`
  - `TELECHAT_BOT_SECRET`
  - `TELECHAT_ADMIN_UID`
  - `ADMIN_API_KEY`
  - `FEISHU_APP_ID`
  - `FEISHU_APP_SECRET`
  - `FEISHU_VERIFICATION_TOKEN`
  - `FEISHU_TARGET_ID`
- 如需覆盖默认值，也可以手动调整普通变量：
  - `TELECHAT_WEBHOOK_PATH`，默认 `/telechat-webhook`
  - `FEISHU_WEBHOOK_PATH`，默认 `/feishu-webhook`
  - `FEISHU_TARGET_MODE`，默认 `open_id`

`linkkv` 已在 `wrangler.jsonc` 中声明，Deploy Button / `wrangler deploy` 会在目标账号下自动创建并绑定 KV。

---

## 1. 项目文件

```text
TeleChat-Link/
├─ src/
│  └─ index.js
├─ package.json
├─ wrangler.jsonc
├─ WiKi.md
└─ README.md
```

---

## 2. 功能概览

### 已实现

- Telegram webhook 接收消息
- 只允许私聊进入主逻辑
- 普通用户 -> 管理员中继
- 普通用户 -> 飞书摘要 + 图片 / 文件 / 音频 / 视频同步
- 飞书文本 / 富文本 / 图片 / 文件 / 音频 / 视频回复 -> 回发原用户
- 管理员 reply -> 回发原用户
- 管理员 `/start` 状态查看与 `/help` 帮助说明
- `/ban`、`/unban` 黑名单管理，支持 reply 当前消息或直接指定用户ID
- 用户档案与黑名单持久化到 KV，不依赖短期 reply 映射
- 用户端、管理员端、飞书端统一回执文案
- `/health` 健康检查
- `/debug/config` 配置检查
- `/teleChatWebhookInfo` 查询 webhook 状态
- `/registerTeleChatWebhook` 注册 webhook
- `/unregisterTeleChatWebhook` 注销 webhook

### 当前限制

- 飞书 `folder`、`sticker` 暂时按文本占位处理，不下载原资源
- TeleChat 图片会优先按飞书图片发送；超出飞书图片限制时会自动降级为文件
- TeleChat 音频若不是飞书要求的 `opus`，会自动按普通文件同步
- 强制管理员通过 **reply** 回复用户，避免串线

### 交互约定

- 普通用户发 `/start` 时会收到欢迎语，管理员端同时收到一条“新会话已打开”提示
- 管理员端 `/start` 用来看运行状态，`/help` 用来看命令说明
- 黑名单为长期 KV 存储，不会因为 7 天 reply 映射或 30 天会话映射过期而失效
- 对外展示时间统一为 `yyyy-MM-dd HH:mm:ss`，时区固定为 `Asia/Shanghai`

---

## 3. 详细部署教程

从环境准备、Secrets 配置、飞书后台配置到联调测试，已经整理到 [WiKi.md](./WiKi.md)。

推荐阅读顺序：

1. 先在 Cloudflare 上一键部署这个仓库
2. 按 [WiKi.md](./WiKi.md) 补齐 Variables 和 Secrets
3. 用 `/health` 和 `/debug/config` 检查 Worker 状态
4. 注册 TeleChat webhook
5. 配置飞书事件订阅并按文档测试整条链路

---

## 4. 本地开发

```bash
npm install
npm run dev
```

部署：

```bash
npm run deploy
```

---

## LICENSE

本项目基于 [Apache License 2.0](./LICENSE) 开源
