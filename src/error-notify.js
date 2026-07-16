// 🚨 錯誤 log 即時通報：攔截 console.error，批次+節流+去重後推播到管理者私聊
// （做法與 stock-bot 一致：首錯後收集 30 秒聚合連環錯誤，兩則通報至少間隔 10 分鐘）
const axios = require('axios');

const ERROR_NOTIFY_DELAY = 30 * 1000;
const ERROR_NOTIFY_COOLDOWN = 10 * 60 * 1000;
const state = { buffer: [], timer: null, lastSentAt: 0, suppressed: 0 };
const originalConsoleError = console.error.bind(console);

function sendToAdmin(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const adminId = process.env.TELEGRAM_ADMIN_CHAT_ID;
  return axios.post(
    `https://api.telegram.org/bot${token}/sendMessage`,
    { chat_id: adminId, text, disable_web_page_preview: true },
    { timeout: 15000 }
  );
}

function queueErrorNotify(line) {
  if (state.buffer.includes(line)) { state.suppressed++; return; } // 相同錯誤去重
  if (state.buffer.length >= 8) { state.suppressed++; return; }    // 單次通報最多列 8 類
  state.buffer.push(line);
  if (state.timer) return;
  const wait = Math.max(ERROR_NOTIFY_DELAY, state.lastSentAt + ERROR_NOTIFY_COOLDOWN - Date.now());
  state.timer = setTimeout(flushErrorNotify, wait);
}

function flushErrorNotify() {
  state.timer = null;
  const lines = state.buffer.splice(0);
  const extra = state.suppressed; state.suppressed = 0;
  if (!lines.length) return;
  state.lastSentAt = Date.now();
  const msg = `🚨 house-bot 錯誤 log 通報 (${lines.length} 類${extra ? `，另有 ${extra} 筆重複已略` : ''})\n\n`
    + lines.map((l) => `• ${l}`).join('\n')
    + `\n\n完整內容: pm2 logs house-bot`;
  // 純文字發送（錯誤內容可能含特殊字元）；發送失敗只記原始 log，不遞迴通報
  sendToAdmin(msg).catch((e) => originalConsoleError(`⚠️ 錯誤通報發送失敗: ${e.message}`));
}

function install() {
  if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_ADMIN_CHAT_ID) {
    return; // 未設定管理者 ID 就不啟用，維持原本行為
  }

  console.error = (...args) => {
    originalConsoleError(...args);
    try {
      const text = args.map((a) => (a instanceof Error ? (a.stack || a.message) : String(a))).join(' ').slice(0, 250);
      queueErrorNotify(text);
    } catch (e) { /* 通報機制本身出錯時絕不影響主程式 */ }
  };

  // 💥 程序級致命錯誤：立即通報後交由 PM2 重啟
  process.on('uncaughtException', (err) => {
    originalConsoleError('💥 未捕捉例外:', err.stack || err.message);
    const msg = `💥 house-bot 發生未捕捉例外，即將由 PM2 重啟\n\n${String(err.stack || err.message).slice(0, 400)}`;
    sendToAdmin(msg).catch(() => {}).finally(() => setTimeout(() => process.exit(1), 1500));
  });
  process.on('unhandledRejection', (reason) => {
    console.error('💥 未處理的 Promise 拒絕:', (reason && reason.message) || String(reason));
  });
}

module.exports = { install };
