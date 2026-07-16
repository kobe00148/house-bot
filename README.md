# house-bot — 591 售屋監控 Telegram Bot

監控 591 售屋網的刊登物件，符合你設定條件的**新上架**或**降價**物件會推播到 Telegram。
與 stock-bot 完全獨立。

## 運作原理

591 售屋列表其實是打內部 API `bff-house.591.com.tw/v1/web/sale/list`，
而且 **API 參數跟 591 網站網址上的 query 一模一樣**。
所以設定條件的方式就是：去 591 網站篩選 → 複製網址 → 貼進 `config.json`。

## 安裝

```bash
cd C:\Users\Wayne\house-bot
npm install
copy .env.example .env   # 填入 TELEGRAM_BOT_TOKEN 和 TELEGRAM_CHAT_ID
```

支援兩種來源，依網址自動判斷：

- **中古屋** `sale.591.com.tw` → `bff-house.591.com.tw/v1/web/sale/list`
- **新建案** `newhouse.591.com.tw/list` → `bff-newhouse.591.com.tw/v1/list-search`（每頁 10 筆、`page` 分頁，必須帶 `device=pc` 分頁才會生效）

## 設定監控條件

1. 打開 <https://sale.591.com.tw>（中古屋）或 <https://newhouse.591.com.tw>（新建案），用網站上的篩選器選好城市、區域、總價、格局、坪數……
2. 複製瀏覽器網址列的網址（例如 `https://sale.591.com.tw/?shType=list&regionid=1&section=5&price=2000$_3000$&pattern=3`）
3. 貼到 `config.json` 的 `searchUrl`，可設定多組：

```json
{
  "intervalMinutes": 30,
  "maxPages": 3,
  "notifyPriceDrop": true,
  "watches": [
    {
      "name": "大安區 3房 2000-3000萬",
      "searchUrl": "https://sale.591.com.tw/?shType=list&regionid=1&section=5&price=2000$_3000$&pattern=3",
      "excludeNewHouse": true,
      "excludeKeywords": ["車位", "地下室"]
    }
  ]
}
```

| 欄位 | 說明 |
|---|---|
| `schedule`（watch 內） | 個別條件的 cron 排程，例如 `"0 9 * * *"`=每天 09:00、`"0 15 * * *"`=每天 15:00。設了就優先於 `intervalMinutes` |
| `intervalMinutes` | 沒設 `schedule` 的條件幾分鐘檢查一次（建議 ≥ 30，對網站友善也避免被擋） |
| `maxPages` | 每個條件最多抓幾頁（中古屋 1 頁 30 筆；新建案 1 頁 10 筆）。可在個別 watch 裡覆寫，新建案建議設大一點把全部建案納入基準 |
| `notifyPriceDrop` | 已記錄的物件降價時也通知 |
| `excludeNewHouse` | 排除混在列表裡的新建案廣告（預設 true） |
| `excludeKeywords` | 標題含這些關鍵字就跳過 |

常用網址參數對照（都可以直接在網站上點選後複製，不用手打）：
`regionid`=城市（1 台北、3 新北）、`section`=行政區、`price=最低$_最高$`=總價（萬）、
`pattern`=房數（3=3房）、`area=最小$_最大$`=坪數、`houseage`=屋齡、`shape`=型態。

## 執行

```bash
npm run dry    # 測試：跑一輪，訊息印在畫面上不發 Telegram
npm run once   # 跑一輪並真的發送，然後結束
npm start      # 常駐：立刻跑一輪，之後照 intervalMinutes 排程

# 用 PM2 常駐
pm2 start ecosystem.config.js
pm2 logs house-bot
```

**首次執行只記錄基準、不發通知**（避免一次灌爆），之後才推播新物件（`notifyPriceDrop: true` 時也推降價）。
常駐模式重啟時，已有基準的條件不會立刻重查，只照排程時間執行。
已通知紀錄存在 `data/seen.json`，刪掉該檔案就會重新建立基準。

## 注意事項

- 591 沒有官方 API，此為網站內部介面，**可能隨改版失效**，屆時需要重新對照參數。
- 請保持低頻率（預設 30 分鐘），大量高頻抓取可能被封鎖 IP 或違反其服務條款。
- 個別物件的聯絡電話等細節請以網站頁面為準。
