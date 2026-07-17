// 🏘 台中市買賣移轉棟數月報（量先價行的量能指標）
// 資料源：台中市政府資料開放平臺（地政局「不動產買賣統計資料」datastore API），每月 5-7 日左右更新上月數字
const axios = require('axios');
const fs = require('fs');
const path = require('path');

// 注意：data_store.view API 只存 50 筆預覽，完整歷史要抓 CSV 檔
const CSV_URL = 'https://newdatacenter.taichung.gov.tw/api/v1/no-auth/resource.download?rid=eded6c07-3652-45cd-98b9-069f75049365';
const STATE_FILE = path.join(__dirname, '..', 'data', 'transfer-state.json');

/** 民國年月 (如 11506) → '2026-06' */
function rocYmToMonth(s) {
  const m = String(s).trim().match(/^(\d{2,3})(\d{2})$/);
  if (!m) return null;
  return `${Number(m[1]) + 1911}-${m[2]}`;
}

/** 抓全部月度資料 → { 'YYYY-MM': 建物棟數 }（CSV 欄位：機關,縣市,年月,件數,土地筆數,土地面積,建物棟數,建物面積） */
async function fetchCounts() {
  const res = await axios.get(CSV_URL, { timeout: 60000, maxRedirects: 5 });
  const lines = String(res.data).split('\n');
  const out = {};
  for (let i = 1; i < lines.length; i++) {
    const c = lines[i].replace(/["﻿\r]/g, '').split(',');
    if (c.length < 7) continue;
    const month = rocYmToMonth(c[2]);
    const count = Number(c[6]);
    if (month && count > 0) out[month] = count;
  }
  return out;
}

function pctText(cur, prev) {
  if (!prev) return '—';
  const pct = ((cur - prev) / prev * 100).toFixed(1);
  return `${pct >= 0 ? '+' : ''}${pct}%`;
}

function verdict(cur, prevM, prevY) {
  const yoy = prevY ? (cur - prevY) / prevY : 0;
  const mom = prevM ? (cur - prevM) / prevM : 0;
  if (yoy > 0.1 && mom > 0) return '量能明顯回溫，市場轉熱；量先價行，價格支撐轉強';
  if (yoy > 0) return '量能溫和回升，市場情緒偏穩';
  if (yoy > -0.1) return '量能持平略縮，市場觀望';
  return '量能明顯萎縮，買方市場；議價空間通常較大';
}

/**
 * 檢查是否有新月份資料，有則回傳報表文字，否則回傳 null。
 * 用 data/transfer-state.json 記住已推播過的月份避免重複。
 */
async function buildReportIfNew() {
  const counts = await fetchCounts();
  const months = Object.keys(counts).sort();
  if (!months.length) return null;
  const latest = months[months.length - 1];

  let state = {};
  try { state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch { /* 首次 */ }
  if (state.lastReported === latest) return null; // 這個月已推過

  const cur = counts[latest];
  const [y, mm] = latest.split('-');
  const prevMonthKey = months[months.length - 2];
  const prevYearKey = `${Number(y) - 1}-${mm}`;
  const prevM = counts[prevMonthKey];
  const prevY = counts[prevYearKey];

  const text = [
    `🏘 台中買賣移轉棟數｜${latest}`,
    '',
    `本月 ${cur.toLocaleString()} 棟`,
    `MoM ${pctText(cur, prevM)}（${prevMonthKey || '—'}：${prevM ? prevM.toLocaleString() : '—'} 棟）`,
    `YoY ${pctText(cur, prevY)}（${prevYearKey}：${prevY ? prevY.toLocaleString() : '—'} 棟）`,
    '',
    `量能判讀：${verdict(cur, prevM, prevY)}`,
    '資料：台中市地政局，移轉登記較實際成交約落後 1-2 個月',
  ].join('\n');

  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify({ lastReported: latest, reportedAt: Date.now() }));
  return { month: latest, text };
}

module.exports = { buildReportIfNew };
