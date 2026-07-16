const axios = require('axios');

const SALE_API = 'https://bff-house.591.com.tw/v1/web/sale/list';
const NEWHOUSE_API = 'https://bff-newhouse.591.com.tw/v1/list-search';
const SALE_PAGE_SIZE = 30;

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

function headersFor(referer) {
  return {
    'User-Agent': UA,
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'zh-TW,zh;q=0.9,en;q=0.8',
    'Referer': referer,
    'Origin': referer.replace(/\/$/, ''),
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 依 searchUrl 網域判斷來源：sale.591（中古屋）或 newhouse.591（新建案） */
function detectSource(searchUrl) {
  return new URL(searchUrl).hostname.includes('newhouse') ? 'newhouse' : 'sale';
}

// ---------- 中古屋 sale.591 ----------

function buildSaleApiUrl(searchUrl, firstRow) {
  const u = new URL(searchUrl);
  const params = new URLSearchParams(u.search);
  params.set('timestamp', Date.now());
  if (!params.has('type')) params.set('type', '2');
  if (!params.has('category')) params.set('category', '1');
  params.set('shType', 'list');
  params.set('firstRow', String(firstRow));
  return `${SALE_API}?${params.toString()}`;
}

function normalizeSale(h) {
  const isNewHouse = Number(h.is_newhouse) === 1;
  return {
    id: String(h.houseid),
    source: 'sale',
    isNewHouse,
    title: h.title || '',
    // 一般物件價格在 price/showprice；混入的新建案廣告在 show_price
    price: Number(h.price) || 0,
    showPrice: isNewHouse
      ? `${h.show_price || ''}${h.show_price_unit || ''}`
      : `${h.showprice || h.price}萬`,
    unitPrice: isNewHouse
      ? `${h.show_unitprice || ''}${h.show_unitprice_unit || ''}`
      : h.unit_price || '',
    room: h.room || '',
    area: h.showarea || (h.area ? `${h.area}坪` : ''),
    age: h.showhouseage || (h.houseage ? `${h.houseage}年` : ''),
    floor: h.floor || '',
    shape: h.shape_name || h.build_purpose || '',
    address: `${h.region_name || ''}${h.section_name || ''}${h.address || h.street_name || ''}`,
    community: h.community_name || '',
    company: '',
    tags: Array.isArray(h.tag) ? h.tag : [],
    photo: h.photo_url || '',
    link: isNewHouse
      ? `https://newhouse.591.com.tw/${h.houseid}`
      : `https://sale.591.com.tw/home/house/detail/2/${h.houseid}.html`,
  };
}

async function fetchSale(watch, { maxPages, pageDelayMs }) {
  const items = [];
  let total = 0;

  for (let page = 0; page < maxPages; page++) {
    const url = buildSaleApiUrl(watch.searchUrl, page * SALE_PAGE_SIZE);
    const res = await axios.get(url, { headers: headersFor('https://sale.591.com.tw/'), timeout: 20000 });
    if (!res.data || res.data.status !== 1 || !res.data.data) {
      throw new Error(`591 sale API 回應異常: ${JSON.stringify(res.data).slice(0, 200)}`);
    }
    const list = res.data.data.house_list || [];
    total = Number(res.data.data.total) || 0;
    items.push(...list.map(normalizeSale));

    if ((page + 1) * SALE_PAGE_SIZE >= total || list.length === 0) break;
    if (page < maxPages - 1) await sleep(pageDelayMs);
  }

  // 排除混在中古屋列表裡的新建案廣告（預設開啟）
  const filtered = watch.excludeNewHouse !== false ? items.filter((it) => !it.isNewHouse) : items;
  return { total, items: filtered };
}

// ---------- 新建案 newhouse.591 ----------

function buildNewhouseApiUrl(searchUrl, page) {
  const u = new URL(searchUrl);
  const params = new URLSearchParams(u.search);
  for (const k of [...params.keys()]) if (k.startsWith('utm_')) params.delete(k);
  params.set('device', 'pc'); // 沒帶 device=pc 時 API 會忽略 page 參數
  params.set('page', String(page));
  return `${NEWHOUSE_API}?${params.toString()}`;
}

function normalizeNewhouse(h) {
  return {
    id: String(h.hid),
    source: 'newhouse',
    isNewHouse: true,
    title: h.build_name || '',
    price: 0, // 新建案價格多為區間或待定字串，不做數值降價比對
    showPrice: `${h.price || ''}${h.price_unit || ''}`,
    unitPrice: '',
    room: h.room || '',
    area: h.area || '',
    age: '',
    floor: '',
    shape: h.build_type_name || '',
    address: h.address || `${h.region || ''}${h.section || ''}${h.addr_number || ''}`,
    community: '',
    company: h.company || '',
    tags: Array.isArray(h.tag) ? h.tag : [],
    photo: h.photo_src || h.cover || '',
    link: `https://newhouse.591.com.tw/${h.hid}`,
  };
}

async function fetchNewhouse(watch, { maxPages, pageDelayMs }) {
  const items = [];
  let total = 0;

  for (let page = 1; page <= maxPages; page++) {
    const url = buildNewhouseApiUrl(watch.searchUrl, page);
    const res = await axios.get(url, { headers: headersFor('https://newhouse.591.com.tw/'), timeout: 20000 });
    if (!res.data || res.data.status !== 1 || !res.data.data) {
      throw new Error(`591 newhouse API 回應異常: ${JSON.stringify(res.data).slice(0, 200)}`);
    }
    const d = res.data.data;
    total = Number(d.total) || 0;
    items.push(...(d.items || []).map(normalizeNewhouse));

    const totalPage = Number(d.total_page) || 1;
    if (page >= totalPage) break;
    if (page < maxPages) await sleep(pageDelayMs);
  }

  return { total, items };
}

// ---------- 共用入口 ----------

/**
 * 抓取一個監控條件的物件列表。
 * watch.searchUrl 支援 sale.591.com.tw 與 newhouse.591.com.tw 的搜尋網址，
 * 網址上的篩選參數會原樣透傳給對應的內部 API。
 * @returns {{ total: number, items: object[] }}
 */
async function fetchWatch(watch, { maxPages = 3, pageDelayMs = 3000 } = {}) {
  const source = detectSource(watch.searchUrl);
  const opts = { maxPages: watch.maxPages || maxPages, pageDelayMs };
  const { total, items } = source === 'newhouse' ? await fetchNewhouse(watch, opts) : await fetchSale(watch, opts);

  const excludeKeywords = watch.excludeKeywords || [];
  const filtered = items.filter((it) => !excludeKeywords.some((kw) => it.title.includes(kw)));

  // 同一物件可能因置頂/廣告重複出現，去重
  const seen = new Set();
  const unique = filtered.filter((it) => {
    if (seen.has(it.id)) return false;
    seen.add(it.id);
    return true;
  });

  return { total, items: unique };
}

module.exports = { fetchWatch };
