# TeleChat-Link Wiki



## 1. 前置准备

你需要准备：

1. 一个 Cloudflare 账号
2. 一个Telegram机器人 token
3. 一个飞书自建应用
4. 管理员账号 ID
5. 如果要本地开发，再额外准备 Node.js 和 npm

---

## 2. 一键部署

直接使用 README 里的 `Deploy to Cloudflare` 按钮。

部署完成后，到：

`Workers & Pages` -> 你的 Worker -> `Settings` -> `Variables and Secrets`

手动补齐 Secrets 和变量。

---

## 3. 配置 Secrets

推荐直接在 Cloudflare Worker 后台手动配置，不要把敏感值写进仓库。

需要配置：

- `TELECHAT_BOT_TOKEN`：Telegram机器人 token
- `TELECHAT_BOT_SECRET`：注册 webhook 时使用的 `secret_token`
- `TELECHAT_ADMIN_UID`：你的管理员Telegram账号 ID
- `ADMIN_API_KEY`：保护管理接口的 Bearer Token
- `FEISHU_APP_ID`：飞书自建应用 `app_id`
- `FEISHU_APP_SECRET`：飞书自建应用 `app_secret`
- `FEISHU_VERIFICATION_TOKEN`：飞书事件订阅 Verification Token
- `FEISHU_TARGET_ID`：要把摘要同步到哪个飞书目标

---

## 4. `wrangler.jsonc` 变量

默认非敏感变量：

```jsonc
{
  "vars": {
    "TELECHAT_WEBHOOK_PATH": "/telechat-webhook",
    "FEISHU_WEBHOOK_PATH": "/feishu-webhook",
    "FEISHU_TARGET_MODE": "open_id"
  }
}
```

### `FEISHU_TARGET_MODE` 可选值

飞书消息发送接口支持多种 `receive_id_type`，常见包括：

- `open_id`
- `user_id`
- `union_id`
- `email`
- `chat_id`

常见用法：

- `open_id`：发到某个飞书用户
- `chat_id`：发到飞书群

默认值是：

```jsonc
"FEISHU_TARGET_MODE": "open_id"
```

如果你要同步到飞书群，可以在后台改成 `chat_id`。

---

## 5. KV 说明

仓库中的 `wrangler.jsonc` 已声明 `linkkv` 绑定，但没有写死账户专属 namespace ID，方便：

- Cloudflare Deploy Button 自动创建并绑定 KV
- 其他人 fork 仓库后直接 `wrangler deploy`

如果你明确要绑定一个现成的 KV，再自己把 namespace ID 填回 `wrangler.jsonc` 即可。

---

## 6. 本地调试

先安装依赖：

```bash
npm install
```

本地开发：

```bash
npm run dev
```

正式部署：

```bash
npm run deploy
```

---

## 7. 检查 Worker 是否在线

部署后先访问：

```text
https://你的域名/health
```

如果返回 JSON，说明 Worker 本身可达。

再检查配置是否齐全：

```bash
curl "https://你的域名/debug/config" \
  -H "Authorization: Bearer 你的ADMIN_API_KEY"
```

---

## 8. 注册主聊天 webhook

Worker 已经内置注册接口，调用：

```bash
curl -X POST "https://你的域名/registerTeleChatWebhook" \
  -H "Authorization: Bearer 你的ADMIN_API_KEY"
```

查询当前 webhook 状态：

```bash
curl "https://你的域名/teleChatWebhookInfo" \
  -H "Authorization: Bearer 你的ADMIN_API_KEY"
```

注销 webhook：

```bash
curl -X POST "https://你的域名/unregisterTeleChatWebhook" \
  -H "Authorization: Bearer 你的ADMIN_API_KEY"
```

---

## 9. 飞书后台配置

### 第一步：创建自建应用

在飞书开放平台创建一个自建应用。

### 第二步：配置权限

推荐租户权限配置如下：

```json
{
  "scopes": {
    "tenant": [
      "im:resource",
      "im:chat",
      "im:message",
      "im:message.group_at_msg:readonly",
      "im:message.p2p_msg:readonly"
    ],
    "user": []
  }
}
```

说明：

- `im:resource`：必需。用于上传图片/文件到飞书，以及下载飞书消息中的资源文件。
- `im:message`：必需。用于发送文本、图片、文件、音频、视频消息。
- `im:message.p2p_msg:readonly`：必需。用于接收飞书单聊消息。
- `im:message.group_at_msg:readonly`：飞书群回复场景保留；仅单聊场景可关闭。
- `im:chat`：本项目未调用群管理接口，可关闭。
- `contact.*`、`directory.*`：本项目未使用，可关闭。

### 第三步：配置事件订阅

请求网址：

```text
https://你的域名/feishu-webhook
```

飞书配置请求网址时会先发送 `url_verification` challenge，Worker 已处理。

### 第四步：订阅事件

至少加上：

- `im.message.receive_v1`

### 第五步：配置 Verification Token

飞书后台里的 Verification Token 要和你设置的 `FEISHU_VERIFICATION_TOKEN` 完全一致。

### 第六步：媒体格式与大小限制

飞书侧限制：

- 图片消息：支持 `JPG`、`JPEG`、`PNG`、`WEBP`、`GIF`、`BMP`、`ICO`、`TIFF`、`HEIC`，大小不超过 `10 MB`。
- 图片分辨率：`GIF` 不超过 `2000 x 2000`，其他图片不超过 `12000 x 12000`。
- 文件上传：大小不超过 `30 MB`。
- 飞书文件上传的 `file_type` 可选值为：`opus`、`mp4`、`pdf`、`doc`、`xls`、`ppt`、`stream`。
- 飞书原生音频消息要求 `OPUS`。项目仅将 `ogg` / `opus` 识别并发送为飞书音频消息，其他音频自动降级为普通文件。
- 飞书原生视频消息要求 `MP4`。项目将视频发送为飞书 `media` 时，还需要时长和缩略图；缩略图缺失或发送失败时自动降级为普通文件。

主聊天（底层 Telegram Bot API）侧限制：

- Worker 从主聊天下载文件时，`getFile` 官方可下载上限为 `20 MB`。这意味着 `主聊天 -> 飞书` 方向的媒体只要超过 `20 MB`，Worker 就无法先下载再继续同步。
- Worker 上传到主聊天时，官方默认限制为：`sendPhoto` 最多 `10 MB`，其他 multipart 文件最多 `50 MB`。

项目实际有效上限：

- `主聊天 -> 飞书`：图片要显示为飞书图片时，应不超过 `10 MB`；`10 MB ~ 20 MB` 的图片可能降级为飞书文件；文件、视频、语音、音频、动图、视频短消息均受主聊天 `20 MB` 下载上限约束。
- `飞书 -> 主聊天`：图片要回到主聊天并显示为图片时，应不超过 `10 MB`；文件、音频、视频回到主聊天时，受飞书 `30 MB` 文件上限约束。
- 主聊天内部“普通用户 <-> 管理员”的媒体中继，多数直接复用已有 `file_id`，不受 Worker 重新上传大小限制。

---

## 10. 推荐测试顺序

先只测文本消息，不要一上来测图片或文件。

### 测试 1：主聊天 -> 管理员

1. 用普通用户给机器人发一条文本
2. 看管理员私聊是否收到转发消息
3. 看用户自己是否收到“接收消息成功✅”提示

### 测试 2：主聊天 -> 飞书

1. 同一条消息是否同步到飞书目标
2. 文本消息先确认摘要是否正常
3. 再分别测试图片、文件、语音、音频、视频、动图，看飞书侧是否显示为对应媒体或文件卡片

### 测试 3：飞书 -> 主聊天用户

1. 在飞书里直接回复那条摘要消息
2. 先测文本，再测图片、文件、音频、视频
3. 看原用户是否收到对应回复
4. 看管理员私聊里是否收到同步提示或对应媒体回显

### 测试 4：管理员 -> 主聊天用户

1. 在管理员私聊中直接 reply 用户消息
2. 看原用户是否收到管理员回复
3. 看管理员自己是否收到“发送成功✅”提示

### 测试 5：黑名单

1. 管理员 reply 某条用户消息发送 `/ban 原因`
2. 让该用户再次发消息，确认不会再转给管理员和飞书，只会收到黑名单提示
3. 管理员再发送 `/unban`
4. 让该用户重新发消息，确认链路恢复

---

## 11. 常见问题

### 1）飞书 URL 验证失败

常见原因：

- `FEISHU_WEBHOOK_PATH` 路径不对
- Worker 还没成功部署
- 飞书后台填错地址
- `FEISHU_VERIFICATION_TOKEN` 不一致
- `workers.dev` 域名在国内网络环境下可能被屏蔽，导致飞书回调校验失败；请切换到自定义 Worker 域名后再次尝试

### 2）主聊天 webhook 注册成功但收不到消息

常见原因：

- `TELECHAT_BOT_SECRET` 不一致
- 注册时路径和实际路径不一致
- 机器人没有收到私聊消息

### 3）飞书回复后，用户没收到

常见原因：

- 你不是 reply 那条由 Worker 推送过去的消息
- 该消息映射已过期
- 飞书应用缺少 `im:resource` 或消息相关权限
- 飞书发来的资源大小超限，或图片分辨率超限
- 你发送的是当前仍按文本占位处理的类型，比如 `folder`、`sticker`

### 4）管理员发消息没回到用户

当前设计要求必须 reply 某条用户消息。如果你直接发一条新消息，Worker 会拒绝，避免串线。

### 5）用户被拉黑后为什么旧消息还能看到

旧消息和旧 reply 映射仍然存在是正常的，但黑名单判断是单独的长期 KV 状态。只要用户在黑名单中，新的转发和回传都会被拦截。

---

## 12. 安全建议

- 不要把 token 或 secret 写进源码仓库
- `/debug/config`、`/registerTeleChatWebhook` 等接口都需要 `Authorization: Bearer <ADMIN_API_KEY>`
- 生产环境建议给 Worker 绑自定义域名
- 生产环境建议开启日志并观察错误输出

---

## 13. 后续可扩展

后面你可以继续加：

- 飞书 `folder` / `sticker` 的更完整处理
- 音频自动转 `OPUS` 后再发飞书，减少降级为文件的情况
- 视频封面自动生成，减少降级为文件的情况
- `/debug/session/:id` 查看会话映射
- 黑名单列表 / 白名单
- 多管理员协作
- 更严格的飞书签名校验
