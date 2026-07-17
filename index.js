require('dotenv').config();
require('./src/error-notify').install();
const schedule = require('node-schedule');
const config = require('./config.json');
const { fetchWatch } = require('./src/crawler');
const { formatItem, send, sendAdmin } = require('./src/telegram');
const store = require('./src/store');

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
