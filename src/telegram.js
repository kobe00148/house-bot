const axios = require('axios');

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// 仲介標題常塞滿裝飾 emoji，全部濾掉保持乾淨
function stripEmoji(s) {
  return String(s)
    .replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

// 訊息開頭 emoji 依監控類型：中古屋 🏠、新成屋 🏢、預售屋 🏗（除此之外不放任何 emoji）
function headEmoji(watchName, source) {
  if (watchName.includes('新成屋')) return '🏢';
  if (watchName.includes('預售屋')) return '🏗';
  return source === 'newhouse' ? '🏗' : '🏠';
}

function formatItem(item, watchName, kind) {
  const label = kind === 'priceDrop' ? '降價' : '新上架';
  // 段落結構：標題段 → 空行 → 房屋資訊段 → 空行 → 連結
  const lines = [
    `${headEmoji(watchName, item.source)} <b>${label}</b>｜${escapeHtml(watchName)}`,
    escapeHtml(stripEmoji(item.title)),
    '',
  ];
  if (item.showPrice) {
    lines.push(`${escapeHtml(item.showPrice)}${item.unitPrice ? `（${escapeHtml(item.unitPrice)}）` : ''}`);
  }
  if (kind === 'priceDrop' && item.prevPrice) {
    lines.push(`${item.prevPrice}萬 → ${item.price}萬`);
  }
  const spec = [item.room, item.area, item.age, item.shape, item.floor].filter(Boolean).join('｜');
  if (spec) lines.push(escapeHtml(spec));
  if (item.address) lines.push(`${escapeHtml(item.address)}${item.community ? `（${escapeHtml(item.community)}）` : ''}`);
  if (item.company) lines.push(escapeHtml(item.company));
  if (item.tags.length) lines.push(escapeHtml(item.tags.join('、')));
  // 超連結放最後，與內容空一行
  lines.push('', item.link);
  return lines.join('\n');
}

async function send(text, { dry = false, chatId: chatIdOverride } = {}) {
  if (dry) {
    console.log('[DRY-RUN] 不發送，訊息內容：\n' + text.replace(/<[^>]+>/g, ''));
    return;
  }
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = chatIdOverride || process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    throw new Error('缺少 TELEGRAM_BOT_TOKEN 或 TELEGRAM_CHAT_ID，請設定 .env');
  }
  await axios.post(
    `https://api.telegram.org/bot${token}/sendMessage`,
    {
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: false,
    },
    { timeout: 15000 }
  );
}

/** 發到管理者私聊（未設定 TELEGRAM_ADMIN_CHAT_ID 時靜默跳過） */
async function sendAdmin(text, { dry = false } = {}) {
  const adminId = process.env.TELEGRAM_ADMIN_CHAT_ID;
  if (!adminId) return;
  await send(text, { dry, chatId: adminId });
}

module.exports = { formatItem, send, sendAdmin };
