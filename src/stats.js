// 📊 591 開價統計：每日快照 + 每週開價週報（僅中古屋監控，預售/新成屋價格為區間字串不納入）
const fs = require('fs');
const path = require('path');
const { fetchWatch } = require('./crawler');

const HISTORY_FILE = path.join(__dirname, '..', 'data', 'history.json');

function loadHistory() {
  try { return JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8')); } catch { return {}; }
}

function saveHistory(h) {
  fs.mkdirSync(path.dirname(HISTORY_FILE), { recursive: true });
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(h, null, 2));
}

function median(arr) {
  const a = [...arr].sort((x, y) => x - y);
  const mid = Math.floor(a.length / 2);
  return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
}

function isSaleWatch(watch) {
  return !new URL(watch.searchUrl).hostname.includes('newhouse');
}

/** 對單一中古屋監控做全量快照，寫入 history。回傳快照物件 */
async function snapshotWatch(watch) {
  const { total, items } = await fetchWatch(watch, { maxPages: 30, pageDelayMs: 2000 });
  const units = items.map((it) => parseFloat(it.unitPrice)).filter((n) => n > 0);
  const prices = items.map((it) => it.price).filter((n) => n > 0);
  const snap = {
    date: new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Taipei' }), // YYYY-MM-DD
    total,
    medianUnit: units.length ? Number(median(units).toFixed(2)) : null,
    medianPrice: prices.length ? Math.round(median(prices)) : null,
  };
  const h = loadHistory();
  const list = (h[watch.name] = h[watch.name] || []);
  const idx = list.findIndex((x) => x.date === snap.date);
  if (idx >= 0) list[idx] = snap; else list.push(snap);
  while (list.length > 400) list.shift();
  saveHistory(h);
  return snap;
}

async function snapshotAll(watches) {
  for (const w of watches.filter(isSaleWatch)) {
    try {
      const s = await snapshotWatch(w);
      console.log(`[開價快照] ${w.name}: ${s.total} 件, 中位數 ${s.medianUnit} 萬/坪`);
    } catch (e) {
      console.error(`[開價快照] ${w.name} 失敗:`, e.message);
    }
  }
}

/** 產生單一監控的週報文字（seenRecord 用來算本週新上架數） */
function weeklyText(watch, seenRecord) {
  const h = loadHistory();
  const list = h[watch.name] || [];
  if (!list.length) return null;
  const latest = list[list.length - 1];
  const weekAgoDate = new Date(Date.now() - 7 * 86400000).toLocaleDateString('sv-SE', { timeZone: 'Asia/Taipei' });
  const prev = [...list].reverse().find((x) => x.date <= weekAgoDate);

  const diff = (cur, old, unit, digits = 1) => {
    if (cur == null) return '—';
    if (!prev || old == null) return `${cur}${unit}（首次統計）`;
    const d = cur - old;
    const sign = d > 0 ? '+' : '';
    return `${cur}${unit}（上週 ${sign}${Number(d.toFixed(digits))}${unit}）`;
  };
  const weekAgoTs = Date.now() - 7 * 86400000;
  const newCount = Object.values(seenRecord || {}).filter((v) => v.firstSeen >= weekAgoTs).length;

  return [
    `📊 591 開價週報｜${watch.name}`,
    '',
    `在售 ${diff(latest.total, prev && prev.total, ' 件', 0)}`,
    `開價中位數 ${diff(latest.medianUnit, prev && prev.medianUnit, ' 萬/坪')}`,
    `總價中位數 ${latest.medianPrice != null ? latest.medianPrice + ' 萬' : '—'}`,
    `本週新上架 ${newCount} 件`,
    '',
    '註：開價非成交價，趨勢供參考',
  ].join('\n');
}

module.exports = { snapshotAll, weeklyText, isSaleWatch };
