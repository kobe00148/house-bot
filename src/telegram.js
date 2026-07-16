const axios = require('axios');

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function formatItem(item, watchName, kind) {
  const head =
    kind === 'priceDrop'
      ? '💸 <b>降價物件</b>'
      : item.source === 'newhouse'
        ? '🏗 <b>新建案</b>'
        : '🏠 <b>新上架物件</b>';
  const lines = [
    `${head}｜${escapeHtml(watchName)}`,
    `<a href="${item.link}">${escapeHtml(item.title)}</a>`,
  ];
  if (item.showPrice) {
    lines.push(`💰 ${escapeHtml(item.showPrice)}${item.unitPrice ? `（${escapeHtml(item.unitPrice)}）` : ''}`);
  }
  if (kind === 'priceDrop' && item.prevPrice) {
    lines.push(`📉 ${item.prevPrice}萬 → ${item.price}萬`);
  }
  const spec = [item.room, item.area, item.age, item.shape, item.floor].filter(Boolean).join('｜');
  if (spec) lines.push(`🛏 ${escapeHtml(spec)}`);
  if (item.address) lines.push(`📍 ${escapeHtml(item.address)}${item.community ? `（${escapeHtml(item.community)}）` : ''}`);
  if (item.company) lines.push(`🏢 ${escapeHtml(item.company)}`);
  if (item.tags.length) lines.push(`🏷 ${escapeHtml(item.tags.join('、'))}`);
  return lines.join('\n');
}

async function send(text, { dry = false } = {}) {
  if (dry) {
    console.log('[DRY-RUN] 不發送，訊息內容：\n' + text.replace(/<[^>]+>/g, ''));
    return;
  }
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
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

module.exports = { formatItem, send };
