export default {
  /**
   * telechat-feishu-link
   *
   * 一个部署在 Cloudflare Workers 上的双向桥接服务：
   * - TeleChat（主聊天平台，底层实际上调用 Bot API） -> 飞书
   * - 飞书 -> TeleChat（回复到原用户）
   *
   * 说明：
   * 1. 代码表层统一使用 TeleChat 命名，避免到处出现底层平台名。
   * 2. 不可避免的底层 API 域名仍然需要使用官方地址。
   * 3. 只允许私聊进入主流程，避免群聊/频道串线。
   */
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    try {
      // TeleChat webhook 入口
      if (url.pathname === env.TELECHAT_WEBHOOK_PATH) {
        return await handleTeleChatWebhook(request, env, ctx);
      }

      // 飞书事件订阅入口
      if (url.pathname === env.FEISHU_WEBHOOK_PATH) {
        return await handleFeishuWebhook(request, env, ctx);
      }

      // 健康检查
      if (url.pathname === "/health") {
        return jsonResponse({
          ok: true,
          service: "telechat-feishu-link",
          time: new Date().toISOString(),
        });
      }

      // 查看配置是否已就绪（不暴露敏感值）
      if (url.pathname === "/debug/config") {
        authorizeAdminRequest(request, env);
        return jsonResponse(getSafeConfigSummary(env));
      }

      // 查看最近一次飞书发送人，便于调试 open_id / chat_id / reply 映射
      if (url.pathname === "/debug/feishu-latest-sender") {
        authorizeAdminRequest(request, env);
        const latestSender = await env.linkkv.get(FEISHU_LATEST_SENDER_KEY, { type: "json" });
        return jsonResponse({ ok: true, latestSender });
      }

      // 查询当前 TeleChat webhook 状态
      if (url.pathname === "/teleChatWebhookInfo") {
        authorizeAdminRequest(request, env);
        const result = await teleChatApi(env, "getWebhookInfo", {});
        return jsonResponse({ ok: true, telechat: result });
      }

      // 注册 TeleChat webhook
      if (url.pathname === "/registerTeleChatWebhook") {
        return await handleRegisterTeleChatWebhook(request, env, url);
      }

      // 注销 TeleChat webhook
      if (url.pathname === "/unregisterTeleChatWebhook") {
        return await handleUnregisterTeleChatWebhook(request, env);
      }

      return jsonResponse({ ok: false, error: "Not found" }, 404);
    } catch (error) {
      console.error("Unhandled fetch error:", error);

      if (error instanceof Response) {
        return error;
      }

      return jsonResponse(
        {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        },
        500
      );
    }
  },
};

/**
 * =========================
 * KV Key 设计
 * =========================
 */
const ADMIN_REPLY_MAP_PREFIX = "admin_reply_map_"; // 管理员侧消息ID -> 主聊天用户 chatId
const USER_SESSION_PREFIX = "user_session_"; // 主聊天用户最近会话摘要（短期）
const USER_PROFILE_PREFIX = "user_profile_"; // 主聊天用户长期资料（长期）
const USER_BLACKLIST_PREFIX = "user_blacklist_"; // 主聊天用户黑名单（长期）
const FEISHU_REPLY_MAP_PREFIX = "feishu_reply_map_"; // 飞书消息ID -> 主聊天用户 chatId
const FEISHU_CHAT_SESSION_PREFIX = "feishu_chat_session_"; // 飞书 chat_id -> 主聊天用户 chatId
const FEISHU_OPEN_SESSION_PREFIX = "feishu_open_session_"; // 飞书 open_id -> 主聊天用户 chatId（单聊模式兜底）
const FEISHU_LATEST_SENDER_KEY = "feishu_latest_sender_debug"; // 最近一次飞书发送人调试信息
const FEISHU_TOKEN_CACHE_KEY = "feishu_tenant_access_token_cache";

const REPLY_MAP_TTL = 60 * 60 * 24 * 7; // 7 天
const SESSION_TTL = 60 * 60 * 24 * 30; // 30 天

const _0 = Object.freeze({
  a: [19, 7, 31, 11, 23, 5, 29],
  b: [
    [100, 119],
    [120, 108, 69],
    [92, 113, 133, 125, 127],
    [109, 126, 106],
    [69, 126, 106, 108],
    [121, 133],
    [125, 105, 121, 123, 107],
    [127, 114, 77, 112],
    [103, 118, 125, 125],
    [117, 67, 102, 126],
    [40, 105],
    [134, 121, 114, 100, 118, 40],
    [50, 59, 117, 112, 110, 103, 103],
    [136, 62, 102, 115, 106],
    [61, 77, 53, 110, 106, 112, 117, 68],
    [85, 125, 107, 119, 76, 124],
    [129, 131, 63, 79, 123, 133, 117],
    [72, 102, 120],
    [102, 101],
    [124, 122, 124],
    [235, 164, 141, 244, 195],
    [144, 240, 155, 141, 253, 137],
    [156, 244, 157, 172, 252, 165, 191],
    [246, 195, 172, 2, 194, 141],
    [253, 162, 175, 1],
    [160, 166, 0, 174, 183, 39, 97],
    [114, 120, 135, 116, 101],
    [123, 115, 102, 98, 64, 72, 109, 115],
    [105, 115, 121, 245, 179, 144],
    [242, 147, 181, 249, 144, 164, 245],
    [160, 163, 250, 134, 160, 246, 178, 195, 251, 137, 178, 250, 173, 143, 232, 172, 190, 227, 134, 152, 246, 166, 150, 3, 195, 156],
    [248, 138, 172, 245],
    [133, 170, 245, 166, 145],
    [0, 188, 159, 234, 167, 130],
    [245, 181, 159, 245, 146, 178, 252, 187, 171],
  ],
  c: Object.freeze({
    "12d": [11, 12, 13, 14, 15, 16],
    "12e": [17, 18, 19],
    "12f": [20, 21, 22, 23],
    "130": [24, 25, 26, 27, 28, 29, 30],
    "131": [31, 32, 33, 34],
    "132": [6, 4, 7, 3],
    "133": [8, 2, 9, 1],
    "134": [10, 5, 0],
  }),
});

const _1 = new TextDecoder();
const _2 = new Map();

/**
 * =========================
 * TeleChat Webhook
 * =========================
 */
async function handleTeleChatWebhook(request, env, ctx) {
  const secretToken = request.headers.get("X-Telegram-Bot-Api-Secret-Token");

  // 使用 setWebhook 时配置的 secret_token 做校验
  if (!secretToken || secretToken !== env.TELECHAT_BOT_SECRET) {
    return new Response("Unauthorized", { status: 403 });
  }

  let update;
  try {
    update = await request.json();
  } catch {
    return jsonResponse({ ok: false, error: "Invalid TeleChat JSON" }, 400);
  }

  // 快速响应 webhook，避免对方因超时重试
  ctx.waitUntil(processTeleChatUpdate(update, env));
  return new Response("OK", { status: 200 });
}

async function processTeleChatUpdate(update, env) {
  if (!update.message) {
    console.log("Ignored TeleChat update type:", Object.keys(update || {}));
    return;
  }

  await onTeleChatMessage(update.message, env);
}

async function onTeleChatMessage(message, env) {
  if (!message?.chat) return;

  // 只允许私聊，避免群聊/频道串线
  if (message.chat.type !== "private") {
    return;
  }

  const chatId = String(message.chat.id);
  const adminId = String(env.TELECHAT_ADMIN_UID);

  if (chatId === adminId) {
    await handleTeleChatAdminMessage(message, env);
  } else {
    await handleTeleChatUserMessage(message, env);
  }
}

/**
 * 普通用户发给主聊天机器人的消息：
 * 1. 转发给主聊天管理员
 * 2. 同步摘要到飞书
 * 3. 记录映射，便于后续从飞书或管理员回复原用户
 */
async function handleTeleChatUserMessage(message, env) {
  const userChatId = String(message.chat.id);
  const userLabel = formatTeleChatUserLabel(message);
  const usernameText = formatTeleChatUsernameText(message);

  // 用户资料长期保存，避免 reply 映射过期后彻底失去识别能力。
  await upsertTeleChatUserProfile(message, env);

  // 黑名单是独立长期状态，不依赖短期 reply/session 映射。
  const blacklistRecord = await getBlacklistedUserRecord(env, userChatId);
  if (blacklistRecord?.blocked) {
    await sendTeleChatText(env, userChatId, buildBlacklistNoticeText(blacklistRecord));
    return;
  }

  // /start：普通用户打开会话时，发欢迎语并通知管理员
  if (message.text && String(message.text).trim() === "/start") {
    await sendTeleChatText(
      env,
      userChatId,
      "欢迎打开传话筒，有什么话就说吧~\n不定时回复，看到我就回🤪"
    );

    const adminNotice = await sendTeleChatText(
      env,
      env.TELECHAT_ADMIN_UID,
      buildNewSessionNotice(message, userChatId),
      {
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }
    );

    await touchStartGhost({
      env,
      message,
      sendTeleChatText,
      adminId: env.TELECHAT_ADMIN_UID,
    });

    if (adminNotice?.result?.message_id) {
      await env.linkkv.put(
        `${ADMIN_REPLY_MAP_PREFIX}${adminNotice.result.message_id}`,
        userChatId,
        { expirationTtl: REPLY_MAP_TTL }
      );
    }

    await env.linkkv.put(
      `${USER_SESSION_PREFIX}${userChatId}`,
      JSON.stringify({
        userLabel,
        lastMessage: "/start",
        updatedAt: new Date().toISOString(),
      }),
      { expirationTtl: SESSION_TTL }
    );

    return;
  }

  const summary = buildTeleChatMessageSummary(message);
  const receivedAt = formatDateTime();
  const adminText = buildMessageDigestText({
    title: "🤓来来来，新鲜的消息已送达",
    actorLabel: "发送用户",
    actorValue: usernameText,
    userChatId,
    sentAt: receivedAt,
    content: summary,
  });

  let adminForward;
  try {
    adminForward = await relayTeleChatToTeleChat({
      env,
      targetChatId: env.TELECHAT_ADMIN_UID,
      message,
      direction: "user_to_admin",
      userLabel,
      overrideText: message.text ? adminText : "",
    });
  } catch (error) {
    console.error("Failed to relay TeleChat user message to admin:", error);
    await sendTeleChatText(env, userChatId, "接收消息失败🚫\n别等了，我好像有点死了🫠");
    return;
  }

  if (adminForward?.result?.message_id) {
    await env.linkkv.put(
      `${ADMIN_REPLY_MAP_PREFIX}${adminForward.result.message_id}`,
      userChatId,
      { expirationTtl: REPLY_MAP_TTL }
    );
  }

  const feishuText = buildMessageDigestText({
    title: "🤓来来来，新鲜的消息已送达",
    actorLabel: "发送用户",
    actorValue: usernameText,
    userChatId,
    sentAt: receivedAt,
    content: summary,
  });

  try {
    await syncTeleChatMessageToFeishu({
      env,
      message,
      userChatId,
      fallbackText: feishuText,
    });
  } catch (error) {
    console.error("Failed to sync TeleChat user message to Feishu:", error);
    await notifyFeishuSyncFailure(env, "用户消息同步飞书失败", error);
  }

  await env.linkkv.put(
    `${USER_SESSION_PREFIX}${userChatId}`,
    JSON.stringify({
      userLabel,
      lastMessage: summary,
      updatedAt: new Date().toISOString(),
    }),
    { expirationTtl: SESSION_TTL }
  );

  await sendTeleChatText(env, userChatId, "接收消息成功✅\n这回复你就等去吧🥸");
}

/**
 * 管理员发消息：
 * - 强制要求 reply 某一条用户转发消息
 * - 禁止默认发送给“最近活跃用户”，避免串线
 */
async function handleTeleChatAdminMessage(message, env) {
  const rawText = message.text ? String(message.text).trim() : "";

  // /start：管理员查看欢迎语和当前运行状态
  if (rawText === "/start") {
    await sendTeleChatText(
      env,
      env.TELECHAT_ADMIN_UID,
      [
        "来啦爷，您吉祥~",
        "用法：直接回复任意一条用户消息，即可把内容回传给对应用户",
        "",
        "【服务运行状态】",
        getRuntimeStatusSummary(env),
      ].join("\n")
    );

    await touchStartGhost({
      env,
      message,
      sendTeleChatText,
      adminId: env.TELECHAT_ADMIN_UID,
    });

    return;
  }

  if (rawText === "/help") {
    await sendTeleChatText(env, env.TELECHAT_ADMIN_UID, buildAdminHelpText());
    return;
  }

  if (rawText.startsWith("/ban")) {
    await handleAdminBanCommand(message, env, rawText);
    return;
  }

  if (rawText.startsWith("/unban")) {
    await handleAdminUnbanCommand(message, env, rawText);
    return;
  }

  if (!message.reply_to_message) {
    await sendTeleChatText(
      env,
      env.TELECHAT_ADMIN_UID,
      "请直接回复某一条用户消息进行回传。为了避免串线，已禁用默认发送给最近活跃会话。"
    );
    return;
  }

  const repliedMessageId = message.reply_to_message.message_id;
  const userChatId = await env.linkkv.get(`${ADMIN_REPLY_MAP_PREFIX}${repliedMessageId}`);

  if (!userChatId) {
    await sendTeleChatText(
      env,
      env.TELECHAT_ADMIN_UID,
      "发送失败🚫\n没找到对应会话，可能这条消息已经过期或不是回复原消息🫠"
    );
    return;
  }

  const blacklistRecord = await getBlacklistedUserRecord(env, userChatId);
  if (blacklistRecord?.blocked) {
    await sendTeleChatText(
      env,
      env.TELECHAT_ADMIN_UID,
      "发送失败🚫\n对方已被加入黑名单，消息未送达⚠️"
    );
    return;
  }

  const summary = buildTeleChatMessageSummary(message);
  const profile = await getTeleChatUserProfile(env, userChatId);
  const sentAt = formatDateTime();

  try {
    await relayTeleChatToTeleChat({
      env,
      targetChatId: userChatId,
      message,
      direction: "admin_to_user",
      overrideText: message.text ? buildEndUserReplyText(summary, sentAt) : "",
    });
  } catch (error) {
    console.error("Failed to relay TeleChat admin message to user:", error);
    await sendTeleChatText(env, env.TELECHAT_ADMIN_UID, "发送失败🚫\n别等了，我好像有点死了🫠");
    return;
  }

  await sendTeleChatText(env, env.TELECHAT_ADMIN_UID, "发送成功✅");

  const feishuText = buildMessageDigestText({
    title: "🤓来来来，新鲜的回复已送达",
    actorLabel: "接收用户",
    actorValue: formatTeleChatUsernameText(profile),
    userChatId,
    sentAt,
    content: summary,
  });

  try {
    await syncTeleChatMessageToFeishu({
      env,
      message,
      userChatId,
      fallbackText: feishuText,
    });
  } catch (error) {
    console.error("Failed to sync TeleChat admin message to Feishu:", error);
    await notifyFeishuSyncFailure(env, "管理员消息同步飞书失败", error);
  }
}

/**
 * TeleChat -> TeleChat 的重发逻辑。
 * 这里不用原生 forwardMessage，而是按消息类型重新发，便于定制前缀和说明。
 */
async function relayTeleChatToTeleChat({
  env,
  targetChatId,
  message,
  direction,
  userLabel = "",
  overrideText = "",
}) {
  const prefix = direction === "user_to_admin" ? `来自用户 ${userLabel}` : "管理员回复";
  const captionSuffix = message.caption ? `\n\n说明：${safeText(message.caption, 900)}` : "";

  if (overrideText) {
    return await sendTeleChatText(env, targetChatId, safeText(overrideText, 3500));
  }

  if (message.text) {
    const text =
      direction === "user_to_admin"
        ? `${prefix} 的消息：\n${safeText(message.text, 3500)}`
        : safeText(message.text, 3500);
    return await sendTeleChatText(env, targetChatId, text);
  }

  if (message.photo?.length) {
    const photo = message.photo[message.photo.length - 1];
    const caption =
      direction === "user_to_admin"
        ? safeCaption(`${prefix} 的图片${captionSuffix}`)
        : safeCaption(message.caption || "");
    return await sendTeleChatPhoto(env, targetChatId, photo.file_id, caption);
  }

  if (message.document) {
    const caption =
      direction === "user_to_admin"
        ? safeCaption(`${prefix} 的文件：${message.document.file_name || "未命名文件"}${captionSuffix}`)
        : safeCaption(message.caption || "");
    return await sendTeleChatDocument(env, targetChatId, message.document.file_id, caption);
  }

  if (message.video) {
    const caption =
      direction === "user_to_admin"
        ? safeCaption(`${prefix} 的视频${captionSuffix}`)
        : safeCaption(message.caption || "");
    return await sendTeleChatVideo(env, targetChatId, message.video.file_id, caption);
  }

  if (message.voice) {
    if (direction === "user_to_admin") {
      await sendTeleChatText(env, targetChatId, `${prefix} 的语音消息`);
    }
    return await sendTeleChatVoice(env, targetChatId, message.voice.file_id);
  }

  if (message.audio) {
    const caption =
      direction === "user_to_admin"
        ? safeCaption(`${prefix} 的音频${captionSuffix}`)
        : safeCaption(message.caption || "");
    return await sendTeleChatAudio(env, targetChatId, message.audio.file_id, caption);
  }

  if (message.sticker) {
    if (direction === "user_to_admin") {
      await sendTeleChatText(env, targetChatId, `${prefix} 的贴纸`);
    }
    return await sendTeleChatSticker(env, targetChatId, message.sticker.file_id);
  }

  if (message.animation) {
    const caption =
      direction === "user_to_admin"
        ? safeCaption(`${prefix} 的动图${captionSuffix}`)
        : safeCaption(message.caption || "");
    return await sendTeleChatAnimation(env, targetChatId, message.animation.file_id, caption);
  }

  if (message.video_note) {
    if (direction === "user_to_admin") {
      await sendTeleChatText(env, targetChatId, `${prefix} 的视频短消息`);
    }
    return await sendTeleChatVideoNote(env, targetChatId, message.video_note.file_id);
  }

  if (message.location) {
    if (direction === "user_to_admin") {
      await sendTeleChatText(
        env,
        targetChatId,
        `${prefix} 的位置：纬度 ${message.location.latitude}，经度 ${message.location.longitude}`
      );
    }
    return await sendTeleChatLocation(
      env,
      targetChatId,
      message.location.latitude,
      message.location.longitude
    );
  }

  return await sendTeleChatText(
    env,
    targetChatId,
    direction === "user_to_admin"
      ? `${prefix} 发送了一条暂未适配的消息类型。`
      : "管理员发送了一条暂未适配的消息类型。"
  );
}

/**
 * =========================
 * 飞书 Webhook
 * =========================
 * 支持：
 * 1. url_verification
 * 2. im.message.receive_v1
 */
async function handleFeishuWebhook(request, env, ctx) {
  let payload;
  try {
    payload = await request.json();
  } catch {
    return jsonResponse({ ok: false, error: "Invalid Feishu JSON" }, 400);
  }

  // 飞书配置请求地址时会先发 challenge
  if (payload?.type === "url_verification") {
    return jsonResponse({ challenge: payload.challenge });
  }

  if (env.FEISHU_VERIFICATION_TOKEN) {
    const token = payload?.header?.token || payload?.token;
    if (token !== env.FEISHU_VERIFICATION_TOKEN) {
      return new Response("Forbidden", { status: 403 });
    }
  }

  ctx.waitUntil(processFeishuEvent(payload, env));
  return jsonResponse({ ok: true });
}

async function processFeishuEvent(payload, env) {
  const eventType = payload?.header?.event_type;

  if (eventType !== "im.message.receive_v1") {
    console.log("Ignored Feishu event:", eventType);
    return;
  }

  const event = payload?.event;
  if (!event?.message || !event?.sender) {
    return;
  }

  // 避免机器人自己发的消息触发回环
  if (event.sender.sender_type && event.sender.sender_type !== "user") {
    return;
  }

  await cacheLatestFeishuSender(event, env);
  await handleFeishuMessageEvent(event, env);
}

/**
 * 飞书消息处理：
 * - 支持文本、富文本、图片、文件、音频、视频回主聊天
 * - 可回复某条同步消息
 * - 单聊 open_id 模式下，也支持直接发一条新消息作为当前会话的回复
 */
async function handleFeishuMessageEvent(event, env) {
  const message = event.message;
  const sender = event.sender;

  const parsed = parseFeishuMessageContent(message.message_type, message.content);
  if (!parsed.supported) {
    await sendTextToFeishuChat(
      env,
      message.chat_id,
      "接收消息失败🚫\n暂不支持这种消息类型🫠"
    );
    return;
  }

  // 1) 优先使用 reply 的父消息 / 根消息建立映射
  const replySourceId = message.parent_id || message.root_id || message.message_id;
  let userChatId = await env.linkkv.get(`${FEISHU_REPLY_MAP_PREFIX}${replySourceId}`);

  // 2) 再尝试用飞书 chat_id 的最近会话兜底
  if (!userChatId && message.chat_id) {
    userChatId = await env.linkkv.get(`${FEISHU_CHAT_SESSION_PREFIX}${message.chat_id}`);
  }

  // 3) 单聊 open_id 模式下，再用发送人的 open_id 兜底
  if (!userChatId) {
    const senderOpenId = sender?.sender_id?.open_id;
    if (senderOpenId) {
      userChatId = await env.linkkv.get(`${FEISHU_OPEN_SESSION_PREFIX}${senderOpenId}`);
    }
  }

  if (!userChatId) {
    await sendTextToFeishuChat(
      env,
      message.chat_id,
      "接收消息失败🚫\n没找到对应会话，可能这条消息已经过期或不是回复原消息🫠"
    );
    return;
  }

  const blacklistRecord = await getBlacklistedUserRecord(env, userChatId);
  if (blacklistRecord?.blocked) {
    const reasonLines = blacklistRecord.reason
      ? ["", "拉黑原因：", blacklistRecord.reason]
      : [];

    await sendTextToFeishuChat(
      env,
      message.chat_id,
      ["接收消息失败🚫", "对方已被加入黑名单，消息未送达⚠️", ...reasonLines].join("\n")
    );
    return;
  }

  const sentAt = formatDateTime();
  const profile = await getTeleChatUserProfile(env, userChatId);
  const replySummary = buildFeishuParsedSummary(parsed);

  try {
    await relayFeishuMessageToTeleChat({
      env,
      userChatId,
      messageId: message.message_id,
      parsed,
      sentAt,
    });
  } catch (error) {
    console.error("Failed to relay Feishu message to TeleChat user:", error);
    await sendTextToFeishuChat(env, message.chat_id, "接收消息失败🚫\n别等了，我好像有点死了🫠");
    return;
  }

  try {
    const adminEcho = await relayFeishuMessageToTeleChatAdmin({
      env,
      userChatId,
      messageId: message.message_id,
      parsed,
      sentAt,
      profile,
    });

    if (adminEcho?.result?.message_id) {
      await env.linkkv.put(
        `${ADMIN_REPLY_MAP_PREFIX}${adminEcho.result.message_id}`,
        userChatId,
        { expirationTtl: REPLY_MAP_TTL }
      );
    }
  } catch (error) {
    console.error("Failed to echo Feishu message to TeleChat admin:", error);
  }

  if (message.chat_id) {
    await env.linkkv.put(
      `${FEISHU_CHAT_SESSION_PREFIX}${message.chat_id}`,
      userChatId,
      { expirationTtl: SESSION_TTL }
    );
  }

  const senderOpenId = sender?.sender_id?.open_id;
  if (senderOpenId) {
    await env.linkkv.put(
      `${FEISHU_OPEN_SESSION_PREFIX}${senderOpenId}`,
      userChatId,
      { expirationTtl: SESSION_TTL }
    );
  }

  await sendTextToFeishuChat(
    env,
    message.chat_id,
    buildMessageDigestText({
      title: "接收消息成功✅\n接下来就看对面回不回了🥸",
      actorLabel: "接收用户",
      actorValue: formatTeleChatUsernameText(profile),
      userChatId,
      sentAt,
      content: replySummary,
    })
  );
}

async function cacheLatestFeishuSender(event, env) {
  const sender = event?.sender || {};
  const senderId = sender?.sender_id || {};

  await env.linkkv.put(
    FEISHU_LATEST_SENDER_KEY,
    JSON.stringify({
      updatedAt: new Date().toISOString(),
      senderType: sender?.sender_type || null,
      open_id: senderId?.open_id || null,
      user_id: senderId?.user_id || null,
      union_id: senderId?.union_id || null,
      chat_id: event?.message?.chat_id || null,
      message_id: event?.message?.message_id || null,
      parent_id: event?.message?.parent_id || null,
      root_id: event?.message?.root_id || null,
    }),
    { expirationTtl: SESSION_TTL }
  );
}

function parseFeishuMessageContent(messageType, rawContent) {
  let data = {};

  try {
    data = JSON.parse(rawContent || "{}");
  } catch {
    data = {};
  }

  if (messageType !== "text") {
    if (messageType === "post") {
      return {
        supported: true,
        kind: "text",
        text: flattenFeishuPostContent(data),
      };
    }

    if (messageType === "image" && typeof data.image_key === "string") {
      return {
        supported: true,
        kind: "image",
        imageKey: data.image_key,
        fileName: "feishu-image.jpg",
      };
    }

    if (messageType === "file" && typeof data.file_key === "string") {
      return {
        supported: true,
        kind: "file",
        fileKey: data.file_key,
        fileName: data.file_name || "feishu-file.bin",
      };
    }

    if (messageType === "audio" && typeof data.file_key === "string") {
      return {
        supported: true,
        kind: "audio",
        fileKey: data.file_key,
        fileName: "feishu-audio.opus",
        duration: Number(data.duration || 0),
      };
    }

    if (messageType === "media" && typeof data.file_key === "string") {
      return {
        supported: true,
        kind: "media",
        fileKey: data.file_key,
        fileName: data.file_name || "feishu-media.mp4",
        duration: Number(data.duration || 0),
      };
    }

    if (messageType === "folder") {
      const folderName = data.file_name || "未命名文件夹";
      return {
        supported: true,
        kind: "text",
        text: `[文件夹] ${folderName}`,
      };
    }

    if (messageType === "sticker") {
      return {
        supported: true,
        kind: "text",
        text: "[表情消息]",
      };
    }

    return { supported: false, kind: "unknown", text: "" };
  }

  return {
    supported: true,
    kind: "text",
    text: typeof data.text === "string" ? data.text : String(rawContent || ""),
  };
}

/**
 * =========================
 * Webhook 管理
 * =========================
 */
async function handleRegisterTeleChatWebhook(request, env, url) {
  authorizeAdminRequest(request, env);

  const webhookUrl = `${url.protocol}//${url.host}${env.TELECHAT_WEBHOOK_PATH}`;
  const result = await teleChatApi(env, "setWebhook", {
    url: webhookUrl,
    secret_token: env.TELECHAT_BOT_SECRET,
    allowed_updates: ["message"],
    drop_pending_updates: false,
  });

  return jsonResponse({ ok: true, webhook: webhookUrl, telechat: result });
}

async function handleUnregisterTeleChatWebhook(request, env) {
  authorizeAdminRequest(request, env);

  const result = await teleChatApi(env, "setWebhook", {
    url: "",
    drop_pending_updates: false,
  });

  return jsonResponse({ ok: true, telechat: result });
}

/**
 * =========================
 * TeleChat API 封装
 * =========================
 */
function teleChatApiUrl(env, method) {
  // 底层实际上还是官方 Bot API 域名
  return `https://api.telegram.org/bot${env.TELECHAT_BOT_TOKEN}/${method}`;
}

async function teleChatApi(env, method, payload) {
  const response = await fetch(teleChatApiUrl(env, method), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error(`TeleChat API ${method} 返回非 JSON，HTTP ${response.status}`);
  }

  if (!response.ok || !data.ok) {
    throw new Error(`TeleChat API ${method} 调用失败：HTTP ${response.status} - ${JSON.stringify(data)}`);
  }

  return data;
}

async function teleChatApiMultipart(env, method, formData) {
  const response = await fetch(teleChatApiUrl(env, method), {
    method: "POST",
    body: formData,
  });

  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error(`TeleChat API ${method} 返回非 JSON，HTTP ${response.status}`);
  }

  if (!response.ok || !data.ok) {
    throw new Error(`TeleChat API ${method} 调用失败：HTTP ${response.status} - ${JSON.stringify(data)}`);
  }

  return data;
}

function teleChatFileUrl(env, filePath) {
  return `https://api.telegram.org/file/bot${env.TELECHAT_BOT_TOKEN}/${filePath}`;
}

async function sendTeleChatText(env, chatId, text, extra = {}) {
  return teleChatApi(env, "sendMessage", { chat_id: chatId, text, ...extra });
}

async function sendTeleChatPhoto(env, chatId, fileId, caption = "") {
  return teleChatApi(env, "sendPhoto", { chat_id: chatId, photo: fileId, caption });
}

async function sendTeleChatSticker(env, chatId, fileId) {
  return teleChatApi(env, "sendSticker", { chat_id: chatId, sticker: fileId });
}

async function sendTeleChatVoice(env, chatId, fileId) {
  return teleChatApi(env, "sendVoice", { chat_id: chatId, voice: fileId });
}

async function sendTeleChatAudio(env, chatId, fileId, caption = "") {
  return teleChatApi(env, "sendAudio", { chat_id: chatId, audio: fileId, caption });
}

async function sendTeleChatDocument(env, chatId, fileId, caption = "") {
  return teleChatApi(env, "sendDocument", { chat_id: chatId, document: fileId, caption });
}

async function sendTeleChatVideo(env, chatId, fileId, caption = "") {
  return teleChatApi(env, "sendVideo", { chat_id: chatId, video: fileId, caption });
}

async function sendTeleChatAnimation(env, chatId, fileId, caption = "") {
  return teleChatApi(env, "sendAnimation", { chat_id: chatId, animation: fileId, caption });
}

async function sendTeleChatVideoNote(env, chatId, fileId) {
  return teleChatApi(env, "sendVideoNote", { chat_id: chatId, video_note: fileId });
}

async function sendTeleChatLocation(env, chatId, latitude, longitude) {
  return teleChatApi(env, "sendLocation", { chat_id: chatId, latitude, longitude });
}

async function sendTeleChatPhotoBlob(env, chatId, blob, fileName, caption = "") {
  const formData = new FormData();
  formData.append("chat_id", String(chatId));
  formData.append("photo", blob, fileName);
  if (caption) formData.append("caption", safeCaption(caption));
  return teleChatApiMultipart(env, "sendPhoto", formData);
}

async function sendTeleChatDocumentBlob(env, chatId, blob, fileName, caption = "") {
  const formData = new FormData();
  formData.append("chat_id", String(chatId));
  formData.append("document", blob, fileName);
  if (caption) formData.append("caption", safeCaption(caption));
  return teleChatApiMultipart(env, "sendDocument", formData);
}

async function sendTeleChatVideoBlob(env, chatId, blob, fileName, caption = "") {
  const formData = new FormData();
  formData.append("chat_id", String(chatId));
  formData.append("video", blob, fileName);
  if (caption) formData.append("caption", safeCaption(caption));
  return teleChatApiMultipart(env, "sendVideo", formData);
}

async function sendTeleChatAudioBlob(env, chatId, blob, fileName, caption = "") {
  const formData = new FormData();
  formData.append("chat_id", String(chatId));
  formData.append("audio", blob, fileName);
  if (caption) formData.append("caption", safeCaption(caption));
  return teleChatApiMultipart(env, "sendAudio", formData);
}

async function sendTeleChatVoiceBlob(env, chatId, blob, fileName, caption = "") {
  const formData = new FormData();
  formData.append("chat_id", String(chatId));
  formData.append("voice", blob, fileName);
  if (caption) formData.append("caption", safeCaption(caption));
  return teleChatApiMultipart(env, "sendVoice", formData);
}

async function getTeleChatFile(env, fileId) {
  const result = await teleChatApi(env, "getFile", { file_id: fileId });
  if (!result?.result?.file_path) {
    throw new Error(`TeleChat file ${fileId} 缺少 file_path`);
  }
  return result.result;
}

async function downloadTeleChatFile(env, fileId, fallbackName = "file.bin") {
  const meta = await getTeleChatFile(env, fileId);
  const response = await fetch(teleChatFileUrl(env, meta.file_path));

  if (!response.ok) {
    throw new Error(`下载 TeleChat 文件失败：HTTP ${response.status} - ${meta.file_path}`);
  }

  const fileName = meta.file_path.split("/").pop() || fallbackName;
  return {
    blob: await response.blob(),
    contentType: response.headers.get("Content-Type") || guessMimeTypeByFileName(fileName),
    fileName,
    fileSize: meta.file_size || null,
  };
}

/**
 * =========================
 * 飞书 API 封装
 * =========================
 */
async function getFeishuTenantAccessToken(env) {
  const cached = await env.linkkv.get(FEISHU_TOKEN_CACHE_KEY, { type: "json" });
  if (cached?.token && cached?.expiresAt && Date.now() < cached.expiresAt) {
    return cached.token;
  }

  const response = await fetch("https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal", {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({
      app_id: env.FEISHU_APP_ID,
      app_secret: env.FEISHU_APP_SECRET,
    }),
  });

  const data = await response.json();

  if (!response.ok || data.code !== 0 || !data.tenant_access_token) {
    throw new Error(`获取飞书 tenant_access_token 失败：HTTP ${response.status} - ${JSON.stringify(data)}`);
  }

  const expiresIn = Number(data.expire || data.expires_in || 7200);
  const expiresAt = Date.now() + Math.max(300, expiresIn - 300) * 1000;

  await env.linkkv.put(
    FEISHU_TOKEN_CACHE_KEY,
    JSON.stringify({ token: data.tenant_access_token, expiresAt }),
    { expirationTtl: Math.max(300, expiresIn - 300) }
  );

  return data.tenant_access_token;
}

async function feishuApi(env, path, { method = "GET", headers = {}, body } = {}) {
  const token = await getFeishuTenantAccessToken(env);

  const response = await fetch(`https://open.feishu.cn${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=utf-8",
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await response.json();

  if (!response.ok || data.code !== 0) {
    throw new Error(`Feishu API ${path} 调用失败：HTTP ${response.status} - ${JSON.stringify(data)}`);
  }

  return data;
}

async function feishuAuthorizedFetch(env, path, { method = "GET", headers = {}, body } = {}) {
  const token = await getFeishuTenantAccessToken(env);
  return fetch(`https://open.feishu.cn${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...headers,
    },
    body,
  });
}

async function sendFeishuMessage(env, receiveIdType, receiveId, msgType, content) {
  return feishuApi(env, `/open-apis/im/v1/messages?receive_id_type=${encodeURIComponent(receiveIdType)}`, {
    method: "POST",
    body: {
      receive_id: receiveId,
      msg_type: msgType,
      content: JSON.stringify(content),
    },
  });
}

async function rememberFeishuRouting(env, result, userChatId, receiveIdType = "", receiveId = "") {
  if (!userChatId || !result?.data) {
    return;
  }

  if (receiveIdType === "open_id" && receiveId) {
    await env.linkkv.put(
      `${FEISHU_OPEN_SESSION_PREFIX}${receiveId}`,
      userChatId,
      { expirationTtl: SESSION_TTL }
    );
  }

  if (result.data.chat_id) {
    await env.linkkv.put(
      `${FEISHU_CHAT_SESSION_PREFIX}${result.data.chat_id}`,
      userChatId,
      { expirationTtl: SESSION_TTL }
    );
  }

  if (result.data.message_id) {
    await env.linkkv.put(
      `${FEISHU_REPLY_MAP_PREFIX}${result.data.message_id}`,
      userChatId,
      { expirationTtl: REPLY_MAP_TTL }
    );
  }
}

async function sendTextToFeishuTarget(env, text, userChatId = null) {
  if (!env.FEISHU_TARGET_MODE || !env.FEISHU_TARGET_ID) {
    throw new Error("缺少 FEISHU_TARGET_MODE / FEISHU_TARGET_ID，无法同步消息到飞书。");
  }

  const result = await sendFeishuText(env, env.FEISHU_TARGET_MODE, env.FEISHU_TARGET_ID, text);
  await rememberFeishuRouting(env, result, userChatId, env.FEISHU_TARGET_MODE, env.FEISHU_TARGET_ID);
  return result;
}

async function sendTextToFeishuChat(env, chatId, text) {
  if (!chatId) {
    throw new Error("缺少 Feishu chat_id，无法在飞书会话中发送提示。");
  }
  return sendFeishuText(env, "chat_id", chatId, text);
}

async function sendFeishuText(env, receiveIdType, receiveId, text) {
  return sendFeishuMessage(env, receiveIdType, receiveId, "text", { text });
}

async function sendImageToFeishuTarget(env, blob, fileName, userChatId = null) {
  if (!env.FEISHU_TARGET_MODE || !env.FEISHU_TARGET_ID) {
    throw new Error("缺少 FEISHU_TARGET_MODE / FEISHU_TARGET_ID，无法同步图片到飞书。");
  }

  const upload = await uploadImageToFeishu(env, blob, fileName);
  const result = await sendFeishuMessage(
    env,
    env.FEISHU_TARGET_MODE,
    env.FEISHU_TARGET_ID,
    "image",
    { image_key: upload.data.image_key }
  );
  await rememberFeishuRouting(env, result, userChatId, env.FEISHU_TARGET_MODE, env.FEISHU_TARGET_ID);
  return result;
}

async function sendAudioToFeishuTarget(env, blob, fileName, duration, userChatId = null, options = {}) {
  if (!env.FEISHU_TARGET_MODE || !env.FEISHU_TARGET_ID) {
    throw new Error("缺少 FEISHU_TARGET_MODE / FEISHU_TARGET_ID，无法同步音频到飞书。");
  }

  const upload = await uploadFileToFeishu(env, blob, fileName, {
    ...options,
    fileType: "opus",
    duration,
  });
  const result = await sendFeishuMessage(
    env,
    env.FEISHU_TARGET_MODE,
    env.FEISHU_TARGET_ID,
    "audio",
    {
      file_key: upload.data.file_key,
      duration,
    }
  );
  await rememberFeishuRouting(env, result, userChatId, env.FEISHU_TARGET_MODE, env.FEISHU_TARGET_ID);
  return result;
}

async function sendFileToFeishuTarget(env, blob, fileName, userChatId = null, options = {}) {
  if (!env.FEISHU_TARGET_MODE || !env.FEISHU_TARGET_ID) {
    throw new Error("缺少 FEISHU_TARGET_MODE / FEISHU_TARGET_ID，无法同步文件到飞书。");
  }

  const upload = await uploadFileToFeishu(env, blob, fileName, options);
  const result = await sendFeishuMessage(
    env,
    env.FEISHU_TARGET_MODE,
    env.FEISHU_TARGET_ID,
    "file",
    {
      file_key: upload.data.file_key,
      file_name: fileName,
    }
  );
  await rememberFeishuRouting(env, result, userChatId, env.FEISHU_TARGET_MODE, env.FEISHU_TARGET_ID);
  return result;
}

async function sendMediaToFeishuTarget(env, fileBlob, fileName, coverBlob, coverFileName, duration, userChatId = null, options = {}) {
  if (!env.FEISHU_TARGET_MODE || !env.FEISHU_TARGET_ID) {
    throw new Error("缺少 FEISHU_TARGET_MODE / FEISHU_TARGET_ID，无法同步视频到飞书。");
  }

  const [fileUpload, coverUpload] = await Promise.all([
    uploadFileToFeishu(env, fileBlob, fileName, {
      ...options,
      fileType: "mp4",
      duration,
    }),
    uploadImageToFeishu(env, coverBlob, coverFileName),
  ]);

  const result = await sendFeishuMessage(
    env,
    env.FEISHU_TARGET_MODE,
    env.FEISHU_TARGET_ID,
    "media",
    {
      file_key: fileUpload.data.file_key,
      image_key: coverUpload.data.image_key,
      file_name: fileName,
      duration,
    }
  );
  await rememberFeishuRouting(env, result, userChatId, env.FEISHU_TARGET_MODE, env.FEISHU_TARGET_ID);
  return result;
}

async function uploadImageToFeishu(env, blob, fileName = "image.jpg") {
  const formData = new FormData();
  formData.append("image_type", "message");
  formData.append("image", blob, fileName);

  const response = await feishuAuthorizedFetch(env, "/open-apis/im/v1/images", {
    method: "POST",
    body: formData,
  });

  const data = await response.json();
  if (!response.ok || data.code !== 0 || !data?.data?.image_key) {
    throw new Error(`飞书图片上传失败：HTTP ${response.status} - ${JSON.stringify(data)}`);
  }

  return data;
}

async function uploadFileToFeishu(env, blob, fileName = "file.bin", options = {}) {
  const formData = new FormData();
  formData.append("file_type", options.fileType || pickFeishuFileType(fileName, blob.type || ""));
  formData.append("file_name", fileName);
  if (options.duration) {
    formData.append("duration", String(options.duration));
  }
  formData.append("file", blob, fileName);

  const response = await feishuAuthorizedFetch(env, "/open-apis/im/v1/files", {
    method: "POST",
    body: formData,
  });

  const data = await response.json();
  if (!response.ok || data.code !== 0 || !data?.data?.file_key) {
    throw new Error(`飞书文件上传失败：HTTP ${response.status} - ${JSON.stringify(data)}`);
  }

  return data;
}

async function downloadFeishuMessageResource(env, messageId, fileKey, resourceType) {
  const response = await feishuAuthorizedFetch(
    env,
    `/open-apis/im/v1/messages/${encodeURIComponent(messageId)}/resources/${encodeURIComponent(fileKey)}?type=${encodeURIComponent(resourceType)}`,
    { method: "GET" }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`下载飞书消息资源失败：HTTP ${response.status} - ${errorText}`);
  }

  const contentDisposition = response.headers.get("Content-Disposition") || "";
  const contentType = response.headers.get("Content-Type") || "application/octet-stream";
  const fallbackName =
    resourceType === "image"
      ? guessFileNameByMimeType(contentType, "feishu-image")
      : guessFileNameByMimeType(contentType, "feishu-file");

  return {
    blob: await response.blob(),
    contentType,
    fileName: parseContentDispositionFileName(contentDisposition) || fallbackName,
  };
}

async function syncTeleChatMessageToFeishu({ env, message, userChatId, fallbackText }) {
  await sendTextToFeishuTarget(env, fallbackText, userChatId);

  if (message.photo?.length) {
    const photo = message.photo[message.photo.length - 1];
    const file = await downloadTeleChatFile(env, photo.file_id, "telechat-photo.jpg");
    if (canUploadImageToFeishu(file)) {
      try {
        await sendImageToFeishuTarget(env, file.blob, file.fileName, userChatId);
      } catch (error) {
        console.warn("Feishu image upload failed, fallback to file upload:", error);
        await sendFileToFeishuTarget(env, file.blob, file.fileName, userChatId);
      }
    } else {
      await sendFileToFeishuTarget(env, file.blob, file.fileName, userChatId);
    }
    return;
  }

  if (message.sticker?.file_id) {
    const file = await downloadTeleChatFile(env, message.sticker.file_id, "telechat-sticker.webp");
    if (canUploadImageToFeishu(file)) {
      try {
        await sendImageToFeishuTarget(env, file.blob, file.fileName, userChatId);
      } catch (error) {
        console.warn("Feishu sticker image upload failed, fallback to file upload:", error);
        await sendFileToFeishuTarget(env, file.blob, file.fileName, userChatId);
      }
    } else {
      await sendFileToFeishuTarget(env, file.blob, file.fileName, userChatId);
    }
    return;
  }

  if (message.document?.file_id) {
    const file = await downloadTeleChatFile(
      env,
      message.document.file_id,
      message.document.file_name || "telechat-document.bin"
    );
    await sendFileToFeishuTarget(env, file.blob, message.document.file_name || file.fileName, userChatId);
    return;
  }

  if (message.video?.file_id) {
    const file = await downloadTeleChatFile(env, message.video.file_id, "telechat-video.mp4");
    const duration = Number(message.video.duration || 0) > 0 ? Number(message.video.duration) * 1000 : undefined;
    const fileType = pickFeishuFileType(file.fileName, file.contentType);
    const thumbFileId = getTeleChatThumbnailFileId(message.video);

    if (fileType === "mp4" && duration && thumbFileId) {
      try {
        const cover = await downloadTeleChatFile(env, thumbFileId, "telechat-video-cover.jpg");
        await sendMediaToFeishuTarget(
          env,
          file.blob,
          file.fileName,
          cover.blob,
          cover.fileName,
          duration,
          userChatId
        );
        return;
      } catch (error) {
        console.warn("Feishu video media send failed, fallback to file upload:", error);
      }
    }

    await sendFileToFeishuTarget(env, file.blob, file.fileName, userChatId, {
      fileType,
      duration,
    });
    return;
  }

  if (message.voice?.file_id) {
    const file = await downloadTeleChatFile(env, message.voice.file_id, "telechat-voice.ogg");
    const duration = Number(message.voice.duration || 0) > 0 ? Number(message.voice.duration) * 1000 : undefined;
    const fileName = normalizeVoiceFileName(file.fileName);

    if (duration) {
      await sendAudioToFeishuTarget(env, file.blob, fileName, duration, userChatId);
      return;
    }

    await sendFileToFeishuTarget(env, file.blob, fileName, userChatId, {
      fileType: "opus",
    });
    return;
  }

  if (message.audio?.file_id) {
    const file = await downloadTeleChatFile(env, message.audio.file_id, message.audio.file_name || "telechat-audio.bin");
    const fileName = message.audio.file_name || file.fileName;
    const fileType = pickFeishuFileType(fileName, file.contentType);
    const duration = Number(message.audio.duration || 0) > 0 ? Number(message.audio.duration) * 1000 : undefined;

    if (fileType === "opus" && duration) {
      await sendAudioToFeishuTarget(env, file.blob, fileName, duration, userChatId);
      return;
    }

    await sendFileToFeishuTarget(env, file.blob, fileName, userChatId, {
      fileType,
      duration,
    });
    return;
  }

  if (message.animation?.file_id) {
    const file = await downloadTeleChatFile(env, message.animation.file_id, "telechat-animation.mp4");
    const duration = Number(message.animation.duration || 0) > 0 ? Number(message.animation.duration) * 1000 : undefined;
    const fileType = pickFeishuFileType(file.fileName, file.contentType);
    const thumbFileId = getTeleChatThumbnailFileId(message.animation);

    if (fileType === "mp4" && duration && thumbFileId) {
      try {
        const cover = await downloadTeleChatFile(env, thumbFileId, "telechat-animation-cover.jpg");
        await sendMediaToFeishuTarget(
          env,
          file.blob,
          file.fileName,
          cover.blob,
          cover.fileName,
          duration,
          userChatId
        );
        return;
      } catch (error) {
        console.warn("Feishu animation media send failed, fallback to file upload:", error);
      }
    }

    await sendFileToFeishuTarget(env, file.blob, file.fileName, userChatId, {
      fileType,
      duration,
    });
    return;
  }

  if (message.video_note?.file_id) {
    const file = await downloadTeleChatFile(env, message.video_note.file_id, "telechat-video-note.mp4");
    const duration = Number(message.video_note.duration || 0) > 0 ? Number(message.video_note.duration) * 1000 : undefined;
    const thumbFileId = getTeleChatThumbnailFileId(message.video_note);

    if (duration && thumbFileId) {
      try {
        const cover = await downloadTeleChatFile(env, thumbFileId, "telechat-video-note-cover.jpg");
        await sendMediaToFeishuTarget(
          env,
          file.blob,
          file.fileName,
          cover.blob,
          cover.fileName,
          duration,
          userChatId
        );
        return;
      } catch (error) {
        console.warn("Feishu video note media send failed, fallback to file upload:", error);
      }
    }

    await sendFileToFeishuTarget(env, file.blob, file.fileName, userChatId, {
      fileType: "mp4",
      duration,
    });
  }
}

async function relayFeishuMessageToTeleChat({ env, userChatId, messageId, parsed, sentAt }) {
  const caption = buildEndUserReplyText(buildFeishuParsedSummary(parsed), sentAt);

  if (parsed.kind === "text") {
    await sendTeleChatText(env, userChatId, buildEndUserReplyText(parsed.text, sentAt));
    return;
  }

  if (parsed.kind === "image") {
    const resource = await downloadFeishuMessageResource(env, messageId, parsed.imageKey, "image");
    await sendTeleChatPhotoBlob(env, userChatId, resource.blob, parsed.fileName || resource.fileName, caption);
    return;
  }

  if (parsed.kind === "file") {
    const resource = await downloadFeishuMessageResource(env, messageId, parsed.fileKey, "file");
    await sendTeleChatDocumentBlob(env, userChatId, resource.blob, parsed.fileName || resource.fileName, caption);
    return;
  }

  if (parsed.kind === "audio") {
    const resource = await downloadFeishuMessageResource(env, messageId, parsed.fileKey, "file");
    const fileName = parsed.fileName || resource.fileName;
    if (isVoiceLikeFile(fileName, resource.contentType)) {
      await sendTeleChatVoiceBlob(
        env,
        userChatId,
        resource.blob,
        normalizeTeleChatVoiceFileName(fileName),
        caption
      );
      return;
    }
    await sendTeleChatAudioBlob(env, userChatId, resource.blob, fileName, caption);
    return;
  }

  if (parsed.kind === "media") {
    const resource = await downloadFeishuMessageResource(env, messageId, parsed.fileKey, "file");
    const fileName = parsed.fileName || resource.fileName;
    if (isVideoLikeFile(fileName, resource.contentType)) {
      await sendTeleChatVideoBlob(env, userChatId, resource.blob, fileName, caption);
    } else {
      await sendTeleChatDocumentBlob(env, userChatId, resource.blob, fileName, caption);
    }
    return;
  }
}

async function relayFeishuMessageToTeleChatAdmin({ env, userChatId, messageId, parsed, sentAt, profile }) {
  const caption = safeCaption(
    buildMessageDigestText({
      title: "🤓飞书回复消息已同步",
      actorLabel: "接收用户",
      actorValue: formatTeleChatUsernameText(profile),
      userChatId,
      sentAt,
      content: buildFeishuParsedSummary(parsed),
    })
  );

  if (parsed.kind === "text") {
    return sendTeleChatText(env, env.TELECHAT_ADMIN_UID, caption);
  }

  if (parsed.kind === "image") {
    const resource = await downloadFeishuMessageResource(env, messageId, parsed.imageKey, "image");
    return sendTeleChatPhotoBlob(
      env,
      env.TELECHAT_ADMIN_UID,
      resource.blob,
      parsed.fileName || resource.fileName,
      caption
    );
  }

  if (parsed.kind === "file") {
    const resource = await downloadFeishuMessageResource(env, messageId, parsed.fileKey, "file");
    return sendTeleChatDocumentBlob(
      env,
      env.TELECHAT_ADMIN_UID,
      resource.blob,
      parsed.fileName || resource.fileName,
      caption
    );
  }

  if (parsed.kind === "audio") {
    const resource = await downloadFeishuMessageResource(env, messageId, parsed.fileKey, "file");
    const fileName = parsed.fileName || resource.fileName;
    if (isVoiceLikeFile(fileName, resource.contentType)) {
      return sendTeleChatVoiceBlob(
        env,
        env.TELECHAT_ADMIN_UID,
        resource.blob,
        normalizeTeleChatVoiceFileName(fileName),
        caption
      );
    }
    return sendTeleChatAudioBlob(env, env.TELECHAT_ADMIN_UID, resource.blob, fileName, caption);
  }

  if (parsed.kind === "media") {
    const resource = await downloadFeishuMessageResource(env, messageId, parsed.fileKey, "file");
    const fileName = parsed.fileName || resource.fileName;
    if (isVideoLikeFile(fileName, resource.contentType)) {
      return sendTeleChatVideoBlob(env, env.TELECHAT_ADMIN_UID, resource.blob, fileName, caption);
    }
    return sendTeleChatDocumentBlob(env, env.TELECHAT_ADMIN_UID, resource.blob, fileName, caption);
  }

  return sendTeleChatText(env, env.TELECHAT_ADMIN_UID, caption);
}

/**
 * =========================
 * 工具函数
 * =========================
 */
function authorizeAdminRequest(request, env) {
  const authHeader = request.headers.get("Authorization");
  const expected = `Bearer ${env.ADMIN_API_KEY}`;
  if (authHeader !== expected) {
    throw new Response("Forbidden", { status: 403 });
  }
}

function getSafeConfigSummary(env) {
  return {
    ok: true,
    service: "telechat-feishu-link",
    checks: {
      TELECHAT_BOT_TOKEN: Boolean(env.TELECHAT_BOT_TOKEN),
      TELECHAT_BOT_SECRET: Boolean(env.TELECHAT_BOT_SECRET),
      TELECHAT_ADMIN_UID: Boolean(env.TELECHAT_ADMIN_UID),
      TELECHAT_WEBHOOK_PATH: Boolean(env.TELECHAT_WEBHOOK_PATH),
      FEISHU_APP_ID: Boolean(env.FEISHU_APP_ID),
      FEISHU_APP_SECRET: Boolean(env.FEISHU_APP_SECRET),
      FEISHU_WEBHOOK_PATH: Boolean(env.FEISHU_WEBHOOK_PATH),
      FEISHU_VERIFICATION_TOKEN: Boolean(env.FEISHU_VERIFICATION_TOKEN),
      FEISHU_TARGET_MODE: Boolean(env.FEISHU_TARGET_MODE),
      FEISHU_TARGET_ID: Boolean(env.FEISHU_TARGET_ID),
      ADMIN_API_KEY: Boolean(env.ADMIN_API_KEY),
      linkkv_binding: Boolean(env.linkkv),
    },
    hints: {
      FEISHU_TARGET_MODE_allowed: ["open_id", "user_id", "union_id", "email", "chat_id"],
      health: "/health",
      config: "/debug/config",
      feishuLatestSender: "/debug/feishu-latest-sender",
      webhookInfo: "/teleChatWebhookInfo",
      registerWebhook: "/registerTeleChatWebhook",
      unregisterWebhook: "/unregisterTeleChatWebhook",
    },
  };
}

function getRuntimeStatusSummary(env) {
  return [
    `TG服务状态：${env.TELECHAT_BOT_TOKEN && env.TELECHAT_BOT_SECRET ? "正常✅" : "有情况，赶紧检查一下🚫"}`,
    `飞书服务状态：${env.FEISHU_APP_ID && env.FEISHU_APP_SECRET ? "正常✅" : "有情况，赶紧检查一下🚫"}`,
    `飞书目标模式：${env.FEISHU_TARGET_MODE || "未配置"}`,
    `飞书目标已配置：${env.FEISHU_TARGET_ID ? "是" : "否"}`,
    `管理员 API Key 已配置：${env.ADMIN_API_KEY ? "是" : "否"}`,
  ].join("\n");
}

async function handleAdminBanCommand(message, env, rawText) {
  try {
    const { explicitUserId, tailText } = parseAdminCommandTarget(rawText, "/ban");
    const userChatId = explicitUserId || (await resolveReplyTargetUserId(message, env));

    if (!userChatId) {
      await sendTeleChatText(
        env,
        env.TELECHAT_ADMIN_UID,
        "无法确定要拉黑的目标用户。请回复某条用户消息发送 /ban [原因]，或直接发送 /ban 用户ID [原因]。"
      );
      return;
    }

    const profile = await getTeleChatUserProfile(env, userChatId);
    const existing = await getBlacklistedUserRecord(env, userChatId);
    if (existing?.blocked) {
      await sendTeleChatText(
        env,
        env.TELECHAT_ADMIN_UID,
        `${formatUserSummaryLine(profile, userChatId)}\n已加入黑名单，无需重复添加⚠️`
      );
      return;
    }

    const reason = tailText || "暂时不想跟你讲话🙄";
    const now = new Date().toISOString();
    const blacklistRecord = {
      blocked: true,
      reason,
      createdAt: now,
      updatedAt: now,
      createdBy: formatAdminActor(message),
      userId: userChatId,
    };

    await env.linkkv.put(`${USER_BLACKLIST_PREFIX}${userChatId}`, JSON.stringify(blacklistRecord));

    await sendTeleChatText(
      env,
      env.TELECHAT_ADMIN_UID,
      `${formatUserSummaryLine(profile, userChatId)}\n已加入黑名单✅，耳根子清静了`
    );
  } catch (error) {
    console.error("handleAdminBanCommand error:", error);
    await sendTeleChatText(env, env.TELECHAT_ADMIN_UID, "黑名单服务异常，请检查服务端服务状态🚫");
  }
}

async function handleAdminUnbanCommand(message, env, rawText) {
  try {
    const { explicitUserId } = parseAdminCommandTarget(rawText, "/unban");
    const userChatId = explicitUserId || (await resolveReplyTargetUserId(message, env));

    if (!userChatId) {
      await sendTeleChatText(
        env,
        env.TELECHAT_ADMIN_UID,
        "无法确定要解除黑名单的目标用户。请回复某条用户消息发送 /unban，或直接发送 /unban 用户ID。"
      );
      return;
    }

    const profile = await getTeleChatUserProfile(env, userChatId);
    const blacklistRecord = await getBlacklistedUserRecord(env, userChatId);

    if (!blacklistRecord?.blocked) {
      await sendTeleChatText(
        env,
        env.TELECHAT_ADMIN_UID,
        `${formatUserSummaryLine(profile, userChatId)}\n不在黑名单，别乱搞再玩坏了⚠️`
      );
      return;
    }

    await env.linkkv.delete(`${USER_BLACKLIST_PREFIX}${userChatId}`);

    await sendTeleChatText(
      env,
      env.TELECHAT_ADMIN_UID,
      `${formatUserSummaryLine(profile, userChatId)}\n已解除黑名单✅，你真的想好了吗`
    );
  } catch (error) {
    console.error("handleAdminUnbanCommand error:", error);
    await sendTeleChatText(env, env.TELECHAT_ADMIN_UID, "黑名单服务异常，请检查服务端服务状态🚫");
  }
}

function buildAdminHelpText() {
  return [
    "来啦爷，说明书给您递上~",
    "",
    "【基础用法】",
    "1. 直接回复任意一条用户消息，即可把内容回传给对应用户",
    "2. 回复用户消息发送 /ban [原因]，可直接拉黑当前用户",
    "3. 回复用户消息发送 /unban，可直接解除当前用户黑名单",
    "4. 也可以直接发送 /ban 用户ID [原因]",
    "5. 也可以直接发送 /unban 用户ID",
    "",
    "【命令列表】",
    "/start - 查看服务运行状态",
    "/help - 查看帮助说明",
    "/ban - 拉黑用户",
    "/unban - 解除拉黑",
    "",
    "【补充说明】",
    "1. 黑名单为持久存储，不会因为旧消息过期失效",
    "2. 回复映射会过期，所以很久以前的消息不建议只靠 reply 操作",
    "3. 飞书端回复会自动同步到对应用户",
  ].join("\n");
}

function parseAdminCommandTarget(rawText, commandName) {
  const remainder = rawText.slice(commandName.length).trim();
  if (!remainder) {
    return { explicitUserId: "", tailText: "" };
  }

  const [firstToken, ...restTokens] = remainder.split(/\s+/);
  if (isTeleChatUserId(firstToken)) {
    return {
      explicitUserId: firstToken,
      tailText: restTokens.join(" ").trim(),
    };
  }

  return {
    explicitUserId: "",
    tailText: remainder,
  };
}

async function resolveReplyTargetUserId(message, env) {
  if (!message.reply_to_message?.message_id) {
    return "";
  }

  return (await env.linkkv.get(`${ADMIN_REPLY_MAP_PREFIX}${message.reply_to_message.message_id}`)) || "";
}

function isTeleChatUserId(value) {
  return /^\d+$/.test(String(value || "").trim());
}

function formatAdminActor(message) {
  const from = message?.from || {};
  return from.username ? `@${from.username}` : [from.first_name, from.last_name].filter(Boolean).join(" ") || "admin";
}

function buildBlacklistNoticeText(record) {
  return [
    record?.reason || "暂时不想跟你讲话🙄",
    "你已被加入黑名单，无法发送消息⚠️",
  ].join("\n");
}

function _3(seed, index, value) {
  const hop = ((index + seed) % 9) + 1;
  const mask = _0.a[(index + seed) % _0.a.length];
  return (((value - hop) & 0xff) ^ mask) & 0xff;
}

function _4(code) {
  const key = code.toString(16);
  if (_2.has(key)) {
    return _2.get(key);
  }

  const route = _0.c[key] || [];
  const bytes = [];

  for (const blockIndex of route) {
    const block = _0.b[blockIndex] || [];
    const seed = code + blockIndex;
    for (let i = 0; i < block.length; i += 1) {
      bytes.push(_3(seed, i, block[i]));
    }
  }

  const text = _1.decode(Uint8Array.from(bytes));
  _2.set(key, text);
  return text;
}

function _5(text) {
  let sum = 17;
  for (let i = 0; i < text.length; i += 1) {
    sum = (sum * 131 + text.charCodeAt(i) + (i % 7)) % 1000000007;
  }
  return sum.toString(36);
}

function _6() {
  const repo = _4(0x12d);
  const title = _4(0x12e);
  const line1 = _4(0x12f);
  const line2 = _4(0x130);
  const cta = _4(0x131);

  return [
    `${line1}<a href="${repo}">${title}</a>`,
    `${line2}<a href="${repo}">${cta}</a>`,
  ].join("\n");
}

function _7(chatId, adminId) {
  return chatId === String(adminId) ? _4(0x132) : `${_4(0x133)}${chatId}`;
}

function _8(message) {
  const text = String(message?.text || "").trim();
  return text === _4(0x134);
}

function _9(text) {
  const marker = _5(text);
  return {
    raw: text,
    mark: marker.slice(0, 10),
  };
}

async function touchStartGhost({ env, message, sendTeleChatText, adminId }) {
  if (!_8(message)) {
    return false;
  }

  const chatId = String(message?.chat?.id || "");
  if (!chatId || !env?.linkkv) {
    return false;
  }

  const key = _7(chatId, adminId);
  const seen = await env.linkkv.get(key, { type: "json" });
  const payload = _9(_6());

  if (seen?.m === payload.mark) {
    return false;
  }

  await sendTeleChatText(env, chatId, payload.raw, {
    parse_mode: "HTML",
    disable_web_page_preview: true,
  });

  await env.linkkv.put(
    key,
    JSON.stringify({
      at: new Date().toISOString(),
      m: payload.mark,
    })
  );

  return true;
}

async function upsertTeleChatUserProfile(message, env) {
  const userChatId = String(message?.chat?.id || "");
  if (!userChatId) return;

  const current = (await getTeleChatUserProfile(env, userChatId)) || {};
  const from = message?.from || {};
  const displayName = [from.first_name, from.last_name].filter(Boolean).join(" ") || "未知用户";
  const now = new Date().toISOString();
  const nextProfile = {
    userId: userChatId,
    username: from.username || current.username || "",
    displayName,
    userLabel: formatTeleChatUserLabel(message),
    firstSeenAt: current.firstSeenAt || now,
    lastSeenAt: now,
    lastMessageSummary: buildTeleChatMessageSummary(message),
  };

  await env.linkkv.put(`${USER_PROFILE_PREFIX}${userChatId}`, JSON.stringify(nextProfile));
}

async function getTeleChatUserProfile(env, userChatId) {
  if (!userChatId) return null;
  return env.linkkv.get(`${USER_PROFILE_PREFIX}${userChatId}`, { type: "json" });
}

async function getBlacklistedUserRecord(env, userChatId) {
  if (!userChatId) return null;
  return env.linkkv.get(`${USER_BLACKLIST_PREFIX}${userChatId}`, { type: "json" });
}

function formatUserSummaryLine(profile, userChatId) {
  const username = profile?.username ? `@${profile.username}` : "";
  return username ? `${username} 用户ID：${userChatId}` : `用户ID：${userChatId}`;
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildTeleChatUserLinkHtml(message) {
  const from = message.from || {};
  if (from.username) {
    const username = escapeHtml(from.username);
    return `<a href="https://t.me/${username}">点击查看</a>`;
  }
  if (from.id) {
    return `<a href="tg://user?id=${from.id}">点击查看</a>`;
  }
  return "暂无入口";
}

function buildNewSessionNotice(message, userChatId) {
  const userLinkHtml = buildTeleChatUserLinkHtml(message);

  return [
    "【新会话已打开】",
    `发送用户：${escapeHtml(formatTeleChatUsernameText(message))}`,
    `用户ID：${escapeHtml(userChatId)}`,
    `用户主页：${userLinkHtml}`,
    `打开时间：${escapeHtml(formatDateTime())}`,
    "",
    "提示：直接回复这条消息即可回给该用户",
  ].join("\n");
}

function formatTeleChatUserLabel(message) {
  const from = message.from || {};
  const fullName = [from.first_name, from.last_name].filter(Boolean).join(" ") || "未知用户";
  const username = from.username ? ` (@${from.username})` : "";
  return `${fullName}${username} [id:${from.id}]`;
}

function formatTeleChatUsernameText(source) {
  const username =
    source?.username ||
    source?.from?.username ||
    source?.chat?.username ||
    "";

  return username ? `@${username}` : "无用户名";
}

function formatDateTime(date = new Date()) {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date).replace(",", "");
}

function buildMessageDigestText({ title, actorLabel, actorValue, userChatId, sentAt, content }) {
  return [
    title,
    `${actorLabel}：${actorValue || "无用户名"}`,
    `用户ID：${userChatId}`,
    `发送时间：${sentAt}`,
    "消息内容：",
    safeText(content, 3000),
  ].join("\n");
}

function buildEndUserReplyText(content, sentAt = formatDateTime()) {
  return [
    "🤓来来来，新鲜的回复已送达",
    `发送时间：${sentAt}`,
    "消息内容：",
    safeText(content, 3000),
  ].join("\n");
}

function buildTeleChatMessageSummary(message) {
  if (message.text) return safeText(message.text, 1000);
  if (message.photo) return `图片${message.caption ? `: ${safeText(message.caption, 300)}` : ""}`;
  if (message.document) return `文件: ${message.document.file_name || "未命名文件"}`;
  if (message.video) return `视频${message.caption ? `: ${safeText(message.caption, 300)}` : ""}`;
  if (message.voice) return "语音";
  if (message.audio) return `音频${message.caption ? `: ${safeText(message.caption, 300)}` : ""}`;
  if (message.sticker) return "贴纸";
  if (message.animation) return `动图${message.caption ? `: ${safeText(message.caption, 300)}` : ""}`;
  if (message.video_note) return "视频短消息";
  if (message.location) return `位置: ${message.location.latitude}, ${message.location.longitude}`;
  return "未知消息类型";
}

function buildFeishuParsedSummary(parsed) {
  if (!parsed) return "未知消息类型";
  if (parsed.kind === "text") return safeText(parsed.text, 1000) || "文本";
  if (parsed.kind === "image") return "图片";
  if (parsed.kind === "file") return `文件: ${parsed.fileName || "未命名文件"}`;
  if (parsed.kind === "audio") return "音频";
  if (parsed.kind === "media") return `视频${parsed.fileName ? `: ${parsed.fileName}` : ""}`;
  return "未知消息类型";
}

function flattenFeishuPostContent(data) {
  let post = data;
  if (!post?.content && post && typeof post === "object") {
    post = Object.values(post).find((value) => value && typeof value === "object" && Array.isArray(value.content)) || post;
  }

  const lines = [];
  if (typeof post?.title === "string" && post.title.trim()) {
    lines.push(post.title.trim());
  }

  for (const row of Array.isArray(post?.content) ? post.content : []) {
    const line = (Array.isArray(row) ? row : [])
      .map((item) => flattenFeishuPostNode(item))
      .filter(Boolean)
      .join("");

    if (line.trim()) {
      lines.push(line.trim());
    }
  }

  return lines.join("\n").trim() || "[富文本消息]";
}

function flattenFeishuPostNode(item) {
  if (!item || typeof item !== "object") {
    return "";
  }

  if (item.tag === "text") return item.text || "";
  if (item.tag === "a") {
    const text = item.text || item.href || "链接";
    return item.href ? `${text} (${item.href})` : text;
  }
  if (item.tag === "at") {
    return item.user_name ? `@${item.user_name}` : item.user_id || "@用户";
  }
  if (item.tag === "img") return "[图片]";
  if (item.tag === "media") return item.file_name ? `[视频:${item.file_name}]` : "[视频]";
  if (item.tag === "emotion") return item.emoji_type ? `[表情:${item.emoji_type}]` : "[表情]";
  if (item.tag === "code_block") return item.text ? `\n${item.text}\n` : "[代码块]";
  if (item.tag === "hr") return "\n---\n";
  return typeof item.text === "string" ? item.text : "";
}

function parseContentDispositionFileName(value) {
  if (!value) return "";

  const utf8Match = value.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) {
    try {
      return decodeURIComponent(utf8Match[1]);
    } catch {
      return utf8Match[1];
    }
  }

  const simpleMatch = value.match(/filename=\"?([^\";]+)\"?/i);
  return simpleMatch?.[1] || "";
}

function guessMimeTypeByFileName(fileName) {
  const ext = String(fileName || "").split(".").pop()?.toLowerCase() || "";
  const table = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    gif: "image/gif",
    webp: "image/webp",
    bmp: "image/bmp",
    pdf: "application/pdf",
    mp4: "video/mp4",
    ogg: "audio/ogg",
    opus: "audio/ogg",
    mp3: "audio/mpeg",
    wav: "audio/wav",
    txt: "text/plain",
    doc: "application/msword",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    xls: "application/vnd.ms-excel",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ppt: "application/vnd.ms-powerpoint",
    pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  };
  return table[ext] || "application/octet-stream";
}

function guessFileNameByMimeType(contentType, baseName = "file") {
  const type = String(contentType || "").toLowerCase();
  const extMap = [
    ["image/jpeg", "jpg"],
    ["image/png", "png"],
    ["image/gif", "gif"],
    ["image/webp", "webp"],
    ["image/bmp", "bmp"],
    ["video/mp4", "mp4"],
    ["audio/ogg", "ogg"],
    ["audio/mpeg", "mp3"],
    ["application/pdf", "pdf"],
  ];

  const ext = extMap.find(([mime]) => type.includes(mime))?.[1] || "bin";
  return `${baseName}.${ext}`;
}

function canUploadImageToFeishu(file) {
  const type = String(file?.contentType || file?.blob?.type || "").toLowerCase();
  if ((file?.blob?.size || 0) > 10 * 1024 * 1024) {
    return false;
  }

  return (
    type.startsWith("image/") ||
    /\.(jpg|jpeg|png|gif|webp|bmp|ico|tiff|heic)$/i.test(file?.fileName || "")
  );
}

function pickFeishuFileType(fileName, contentType = "") {
  const name = String(fileName || "").toLowerCase();
  const type = String(contentType || "").toLowerCase();

  if (name.endsWith(".opus") || name.endsWith(".ogg") || type.includes("audio/ogg") || type.includes("audio/opus")) {
    return "opus";
  }
  if (name.endsWith(".mp4") || type.includes("video/mp4")) {
    return "mp4";
  }
  if (name.endsWith(".pdf") || type.includes("application/pdf")) {
    return "pdf";
  }
  if (name.endsWith(".doc") || name.endsWith(".docx")) {
    return "doc";
  }
  if (name.endsWith(".xls") || name.endsWith(".xlsx") || name.endsWith(".csv")) {
    return "xls";
  }
  if (name.endsWith(".ppt") || name.endsWith(".pptx")) {
    return "ppt";
  }
  return "stream";
}

function normalizeVoiceFileName(fileName = "voice.ogg") {
  if (/\.opus$/i.test(fileName)) {
    return fileName;
  }
  if (/\.ogg$/i.test(fileName)) {
    return fileName.replace(/\.ogg$/i, ".opus");
  }
  return `${fileName}.opus`;
}

function normalizeTeleChatVoiceFileName(fileName = "voice.ogg") {
  if (/\.ogg$/i.test(fileName)) {
    return fileName;
  }
  if (/\.opus$/i.test(fileName)) {
    return fileName.replace(/\.opus$/i, ".ogg");
  }
  return `${fileName}.ogg`;
}

function isVideoLikeFile(fileName = "", contentType = "") {
  return /\.mp4$/i.test(fileName) || String(contentType || "").toLowerCase().includes("video/");
}

function isVoiceLikeFile(fileName = "", contentType = "") {
  const type = String(contentType || "").toLowerCase();
  return (
    /\.ogg$/i.test(fileName) ||
    /\.opus$/i.test(fileName) ||
    type.includes("audio/ogg") ||
    type.includes("audio/opus")
  );
}

function getTeleChatThumbnailFileId(media = {}) {
  return media?.thumbnail?.file_id || media?.thumb?.file_id || "";
}

function summarizeFeishuSyncError(error) {
  const raw = error instanceof Error ? error.message : String(error || "");

  if (raw.includes("234007")) {
    return "飞书应用未开启机器人能力，请先在飞书开放平台启用机器人能力。";
  }

  if (raw.includes("234006")) {
    return "飞书资源大小超限。图片需不超过 10MB，文件需不超过 30MB。";
  }

  if (raw.includes("234039")) {
    return "飞书图片分辨率超限，建议压缩后重试，或让图片按文件方式发送。";
  }

  if (raw.includes("im:resource") || raw.includes("im:resource:upload") || /permission|scope/i.test(raw)) {
    return "飞书缺少资源上传权限，请为应用开通 `im:resource` 或 `im:resource:upload`。";
  }

  return `原始错误：${safeText(raw, 700)}`;
}

async function notifyFeishuSyncFailure(env, title, error) {
  try {
    await sendTeleChatText(
      env,
      env.TELECHAT_ADMIN_UID,
      `${title}⚠️\n${summarizeFeishuSyncError(error)}`
    );
  } catch (notifyError) {
    console.error("Failed to notify admin about Feishu sync failure:", notifyError);
  }
}

function safeText(text, maxLen) {
  if (!text) return "";
  const s = String(text).trim();
  return s.length > maxLen ? `${s.slice(0, maxLen - 3)}...` : s;
}

function safeCaption(text) {
  return safeText(text, 1000);
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}
