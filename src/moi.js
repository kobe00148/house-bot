// 📈 內政部實價登錄：下載季度 CSV、彙整月度成交統計、產生走勢月報
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');

const CACHE_FILE = path.join(__dirname, '..', 'data', 'moi-cache.json');

const REGIONS = [
  { key: 'taichung', file: 'b_lvr_land_a.csv', districts: ['西屯區', '南屯區'], label: '台中 西屯/南屯' },
  { key: 'beigang', file: 'p_lvr_land_a.csv', districts: ['北港鎮'], label: '雲林 北港鎮' },
];
// 只統計住宅類建物型態（排除店面、辦公、廠房、純車位等）
const RESIDENTIAL = ['住宅大樓', '華廈', '公寓', '透天厝', '套房'];
const PING_PER_SQM = 3.305785 / 10000; // 元/平方公尺 → 萬/坪 的係數（再乘上單價）

function currentSeason() {
  const d = new Date();
  return { year: d.getFullYear() - 1911, q: Math.ceil((d.getMonth() + 1) / 3) };
}

/** 由近到遠列出 n 個季度代碼，如 ['115S3','115S2','115S1','114S4'] */
function seasonList(n) {
  let { year, q } = currentSeason();
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push(`${year}S${q}`);
    q--;
    if (q === 0) { q = 4; year--; }
  }
  return out;
}

function parseCsvLine(line) {
  const out = [];
  let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } else inQ = false;
      } else cur += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ',') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

/** 民國日期字串 (如 1150402) → 'YYYY-MM'，無效回傳 null */
function rocToMonth(s) {
  const m = String(s).trim().match(/^(\d{2,3})(\d{2})(\d{2})$/);
  if (!m) return null;
  return `${Number(m[1]) + 1911}-${m[2]}`;
}

/** 解析一份縣市 CSV，回傳 { 'YYYY-MM': [萬/坪, ...] }（僅住宅、僅含建物之交易） */
function aggregateCsv(text, districts) {
  const lines = text.split('\n');
  const months = {};
  for (let i = 2; i < lines.length; i++) { // 跳過中英文兩行表頭
    if (!lines[i].trim()) continue;
    const c = parseCsvLine(lines[i]);
    if (!districts.includes(c[0])) continue;
    if (!String(c[1]).includes('房地')) continue; // 排除純土地、純車位
    if (!RESIDENTIAL.some((t) => String(c[11]).startsWith(t))) continue;
    const month = rocToMonth(c[7]);
    const unit = Number(c[22]) * PING_PER_SQM;
    if (!month || !unit || unit <= 0) continue;
    (months[month] = months[month] || []).push(Number(unit.toFixed(2)));
  }
  return months;
}

function loadCache() {
  try { return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')); } catch { return { seasons: {} }; }
}

async function downloadSeason(season, isCurrent) {
  // 當季尚未發布季度檔，用「本期」滾動端點；歷史季度用 DownloadSeason
  const url = isCurrent
    ? 'https://plvr.land.moi.gov.tw/Download?type=zip&fileName=lvr_landcsv.zip'
    : `https://plvr.land.moi.gov.tw/DownloadSeason?season=${season}&type=zip&fileName=lvr_landcsv.zip`;
  const res = await axios.get(url, { responseType: 'arraybuffer', timeout: 300000 });
  return Buffer.from(res.data);
}

/**
 * 抓取近 seasonsCount 個季度並彙整（最近兩季每次重抓，較舊季度用快取）。
 * 回傳 { taichung: { 'YYYY-MM': [單價...] }, beigang: {...} }
 */
async function fetchAll(seasonsCount = 4) {
  const cache = loadCache();
  const seasons = seasonList(seasonsCount);
  for (let i = 0; i < seasons.length; i++) {
    const s = seasons[i];
    const isRecent = i < 2; // 最近兩季登錄還在累積，每次重抓
    if (!isRecent && cache.seasons[s]) continue;
    console.log(`[實價登錄] 下載 ${s} ...`);
    try {
      const zip = new AdmZip(await downloadSeason(s, i === 0));
      const entry = { fetchedAt: Date.now() };
      for (const r of REGIONS) {
        const buf = zip.readFile(r.file);
        entry[r.key] = buf ? aggregateCsv(buf.toString('utf8'), r.districts) : {};
      }
      cache.seasons[s] = entry;
    } catch (e) {
      console.error(`[實價登錄] ${s} 下載/解析失敗，跳過:`, e.message);
    }
  }
  fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
  fs.writeFileSync(CACHE_FILE, JSON.stringify(cache));

  // 跨季合併（同一交易月可能散落多個季度檔：補登錄）
  const merged = {};
  for (const r of REGIONS) merged[r.key] = {};
  for (const s of seasons) {
    const e = cache.seasons[s];
    if (!e) continue;
    for (const r of REGIONS) {
      for (const [month, arr] of Object.entries(e[r.key] || {})) {
        (merged[r.key][month] = merged[r.key][month] || []).push(...arr);
      }
    }
  }
  return merged;
}

function median(arr) {
  const a = [...arr].sort((x, y) => x - y);
  const mid = Math.floor(a.length / 2);
  return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
}

/** 產生各區域的月報文字，回傳 [{ key, label, text }] */
async function buildReports(monthsShown = 6) {
  const merged = await fetchAll();
  const reports = [];
  for (const r of REGIONS) {
    const byMonth = merged[r.key];
    const months = Object.keys(byMonth).sort().slice(-monthsShown);
    if (!months.length) {
      reports.push({ key: r.key, label: r.label, text: `📈 實價登錄月報｜${r.label}（住宅買賣）\n\n近期無成交登錄資料` });
      continue;
    }
    const lines = months.map((m) => {
      const arr = byMonth[m];
      return `${m}｜${median(arr).toFixed(1)} 萬/坪｜${arr.length} 件`;
    });
    const first = median(byMonth[months[0]]);
    const last = median(byMonth[months[months.length - 1]]);
    const pct = ((last - first) / first * 100).toFixed(1);
    const text = [
      `📈 實價登錄月報｜${r.label}（住宅買賣）`,
      '',
      ...lines,
      '',
      `${months[0]} → ${months[months.length - 1]} 中位數單價 ${first.toFixed(1)} → ${last.toFixed(1)} 萬/坪（${pct >= 0 ? '+' : ''}${pct}%）`,
      '註：登錄申報有時間差，最近 1-2 個月件數尚在累積',
    ].join('\n');
    reports.push({ key: r.key, label: r.label, text });
  }
  return reports;
}

module.exports = { buildReports };
