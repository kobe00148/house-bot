require('dotenv').config();
require('./src/error-notify').install();
const schedule = require('node-schedule');
const config = require('./config.json');
const { fetchWatch } = require('./src/crawler');
const { formatItem, send, sendAdmin } = require('./src/telegram');
const store = require('./src/store');
const moi = require('./src/moi');
const stats = require('./src/stats');
const transfer = require('./src/transfer');

const ONCE = process.argv.includes('--once');
const DRY = process.argv.includes('--dry');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' });

let running = false;

/** 跑單一監控條件：讀取紀錄 → 抓取比對 → 寫回紀錄 */
async function runOne(watch) {
  while (running) await sleep(2000); // 避免兩個排程撞在同一時間同時讀寫紀錄
  running = true;
  try {
    const seen = store.load();
    await runWatch(watch, seen);
    store.save(seen);
  } catch (e) {
    console.error(`[${now()}] [${watch.name}] 抓取失敗:`, e.message);
  } finally {
    running = false;
  }
}

async function runWatch(watch, seen) {
  const { total, items } = await fetchWatch(watch, {
    maxPages: config.maxPages,
    pageDelayMs: config.pageDelayMs,
  });
  console.log(`[${now()}] [${watch.name}] 符合條件 ${total} 筆，本次比對 ${items.length} 筆`);

  // 首次執行：只記錄基準，不發送，避免一次灌爆通知
  const isFirstRun = !seen[watch.name];
  if (isFirstRun) {
    seen[watch.name] = {};
    for (const it of items) {
      seen[watch.name][it.id] = { price: it.price, firstSeen: Date.now() };
    }
    console.log(`[${now()}] [${watch.name}] 首次執行，記錄 ${items.length} 筆為基準（不通知）`);
    return;
  }

  const record = seen[watch.name];
  let notified = 0;
  for (const it of items) {
    const prev = record[it.id];

    if (!prev) {
      // 新上架
      await send(formatItem(it, watch.name, 'new'), { dry: DRY, chatId: watch.chatId });
      record[it.id] = { price: it.price, firstSeen: Date.now() };
      notified++;
      console.log(`[${now()}] [${watch.name}] 通知新物件 ${it.id} ${it.title.slice(0, 20)}`);
      await sleep(1500); // Telegram 限流保護
    } else if (
      config.notifyPriceDrop &&
      it.price > 0 &&
      prev.price > 0 &&
      it.price < prev.price
    ) {
      // 降價（config.notifyPriceDrop 為 true 時才通知）
      await send(formatItem({ ...it, prevPrice: prev.price }, watch.name, 'priceDrop'), { dry: DRY, chatId: watch.chatId });
      notified++;
      console.log(`[${now()}] [${watch.name}] 通知降價 ${it.id}: ${prev.price} → ${it.price}`);
      record[it.id].price = it.price;
      await sleep(1500);
    } else if (it.price > 0 && it.price !== prev.price) {
      record[it.id].price = it.price; // 價格變動只更新紀錄，不通知
    }
  }

  // 無任何通知時發一行心跳到管理者私聊（不吵群組），確認排程有跑
  if (notified === 0 && config.noNewsHeartbeat) {
    const hhmm = new Date().toLocaleTimeString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false, hour: '2-digit', minute: '2-digit' });
    await sendAdmin(`✅ ${hhmm} ${watch.name} 檢查完成，無新物件（${items.length} 筆均已記錄）`, { dry: DRY });
    console.log(`[${now()}] [${watch.name}] 無新物件，心跳已發到管理者私聊`);
  }
}

// 各區域報表的推播對象：北港報表推北港群組，其餘推主群組
function reportChatId(regionKey) {
  if (regionKey === 'beigang') {
    const w = config.watches.find((x) => x.name.startsWith('雲林北港'));
    return w && w.chatId;
  }
  return undefined; // 主群組
}

async function runMoiReports() {
  const reports = await moi.buildReports();
  for (const r of reports) {
    await send(r.text, { dry: DRY, chatId: reportChatId(r.key) });
    console.log(`[${now()}] [實價登錄月報] ${r.label} 已推播`);
  }
}

async function runTransferReport() {
  const r = await transfer.buildReportIfNew();
  if (!r) return; // 尚無新月份或已推播過
  await send(r.text, { dry: DRY }); // 台中量能推主群組
  console.log(`[${now()}] [移轉棟數] ${r.month} 已推播`);
}

async function runWeeklyReports() {
  const seen = store.load();
  for (const watch of config.watches.filter(stats.isSaleWatch)) {
    const text = stats.weeklyText(watch, seen[watch.name]);
    if (!text) continue;
    await send(text, { dry: DRY, chatId: watch.chatId });
    console.log(`[${now()}] [開價週報] ${watch.name} 已推播`);
  }
}

(async () => {
  console.log(`[${now()}] house-bot 啟動${DRY ? '（dry-run 模式，不發 Telegram）' : ''}`);

  if (ONCE) {
    for (const watch of config.watches) {
      await runOne(watch);
      await sleep(config.watchDelayMs || 5000);
    }
    console.log(`[${now()}] --once 執行完畢，結束`);
    return;
  }

  // 啟動時：還沒有基準的監控先跑一次建立基準（重啟不會重複查詢已有基準的條件）
  const seen = store.load();
  for (const watch of config.watches) {
    if (!seen[watch.name]) {
      console.log(`[${now()}] [${watch.name}] 尚無基準，先執行一次`);
      await runOne(watch);
      await sleep(config.watchDelayMs || 5000);
    }
  }

  // Web 介面：/ 狀態頁、/logs 瀏覽器看 log
  require('./src/web').start(config, store);

  // 📈 實價登錄月報：每月 11 日 10:00（官方每月 1/11/21 日更新資料）
  schedule.scheduleJob(config.moiMonthlySchedule || '0 10 11 * *', () => runMoiReports().catch((e) => console.error('實價登錄月報失敗:', e.message)));
  // 📊 591 開價快照：每天 09:30；週報：每週日 20:00
  schedule.scheduleJob('30 9 * * *', () => stats.snapshotAll(config.watches).catch((e) => console.error('開價快照失敗:', e.message)));
  schedule.scheduleJob(config.weekly591Schedule || '0 20 * * 0', () => runWeeklyReports().catch((e) => console.error('開價週報失敗:', e.message)));
  // 🏘 台中移轉棟數：地政局每月 5-7 日左右更新，5-12 日每天檢查一次、抓到新月份才推播
  schedule.scheduleJob('30 10 5-12 * *', () => runTransferReport().catch((e) => console.error('移轉棟數月報失敗:', e.message)));
  console.log(`[${now()}] 報表排程：實價登錄月報(每月11日10:00)、開價快照(每日09:30)、開價週報(週日20:00)、移轉棟數(每月5-12日檢查)`);

  // 每個監控條件依自己的 cron 排程執行；沒設 schedule 的用全域 intervalMinutes
  for (const watch of config.watches) {
    if (watch.schedule) {
      schedule.scheduleJob(watch.schedule, () => runOne(watch));
      console.log(`[${now()}] [${watch.name}] 排程：cron "${watch.schedule}"`);
    } else {
      const minutes = config.intervalMinutes || 30;
      schedule.scheduleJob(`*/${minutes} * * * *`, () => runOne(watch));
      console.log(`[${now()}] [${watch.name}] 排程：每 ${minutes} 分鐘`);
    }
  }
})();
