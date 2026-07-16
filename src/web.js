// 🌐 Web 介面：/ 狀態頁 + /logs 瀏覽器看 PM2 log（做法與 stock-bot 一致）
const express = require('express');
const fs = require('fs');
const path = require('path');
const os = require('os');

const START_TIME = Date.now();

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function tailLogFile(filePath, maxLines) {
  try {
    const stat = fs.statSync(filePath);
    const readSize = Math.min(stat.size, 131072); // 128KB
    const buf = Buffer.alloc(readSize);
    const fd = fs.openSync(filePath, 'r');
    fs.readSync(fd, buf, 0, readSize, stat.size - readSize);
    fs.closeSync(fd);
    const lines = buf.toString('utf8').split('\n').filter((l) => l.trim());
    return lines.slice(-maxLines);
  } catch (e) {
    return [`(無法讀取 ${filePath}: ${e.message})`];
  }
}

const PAGE_STYLE = `
    body { font-family: "Segoe UI", "Microsoft JhengHei", sans-serif; background: #0f172a; color: #e2e8f0; margin: 0; padding: 24px; }
    h1 { font-size: 20px; margin: 0 0 4px; }
    h2 { font-size: 15px; margin: 24px 0 8px; color: #7dd3fc; }
    .sub { color: #94a3b8; font-size: 13px; }
    .sub a, td a { color: #7dd3fc; }
    pre { background: #020617; border: 1px solid #1e293b; border-radius: 8px; padding: 14px;
          font-size: 12.5px; line-height: 1.55; overflow-x: auto; white-space: pre-wrap; word-break: break-all; }
    .err { color: #fca5a5; }
    table { border-collapse: collapse; margin-top: 8px; font-size: 13.5px; }
    th, td { border: 1px solid #1e293b; padding: 8px 12px; text-align: left; }
    th { background: #1e293b; color: #7dd3fc; }`;

function renderStatusPage(config, store) {
  const nowStr = new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false });
  const upMin = Math.floor((Date.now() - START_TIME) / 60000);
  const seen = store.load();
  const rows = config.watches.map((w) => {
    const count = Object.keys(seen[w.name] || {}).length;
    return `<tr><td>${escapeHtml(w.name)}</td><td><code>${escapeHtml(w.schedule || `每 ${config.intervalMinutes} 分`)}</code></td><td>${count}</td><td><a href="${escapeHtml(w.searchUrl)}" target="_blank">591 ↗</a></td></tr>`;
  }).join('');

  return `<!DOCTYPE html>
<html lang="zh-TW">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Mamba-House Bot</title>
<style>${PAGE_STYLE}</style>
</head>
<body>
    <h1>🏠 house-bot 狀態</h1>
    <div class="sub">台北時間 ${nowStr}｜已運行 ${Math.floor(upMin / 60)} 小時 ${upMin % 60} 分｜<a href="/logs">📜 查看 Log</a></div>

    <h2>👀 監控條件</h2>
    <table>
        <tr><th>名稱</th><th>排程</th><th>已記錄物件</th><th>條件連結</th></tr>
        ${rows}
    </table>

    <h2>🔔 通知設定</h2>
    <div class="sub">降價通知：${config.notifyPriceDrop ? '開啟' : '關閉'}｜錯誤通報：${process.env.TELEGRAM_ADMIN_CHAT_ID ? '開啟（管理者私聊）' : '未設定'}</div>
</body>
</html>`;
}

function renderLogsPage(linesParam) {
  const maxLines = Math.min(Math.max(parseInt(linesParam, 10) || 300, 50), 2000);
  const logDir = path.join(os.homedir(), '.pm2', 'logs');
  const outLines = tailLogFile(path.join(logDir, 'house-bot-out.log'), maxLines);
  const errLines = tailLogFile(path.join(logDir, 'house-bot-error.log'), 100);
  const nowStr = new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false });

  return `<!DOCTYPE html>
<html lang="zh-TW">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="refresh" content="30">
<title>Mamba-House Bot Log</title>
<style>${PAGE_STYLE}</style>
</head>
<body>
    <h1>📜 運行 Log</h1>
    <div class="sub">台北時間 ${nowStr}｜顯示最後 ${maxLines} 行 (可用 ?lines=1000 調整)｜每 30 秒自動更新｜<a href="/">← 返回狀態頁</a></div>

    <h2>❌ 錯誤 Log (最後 100 行)</h2>
    <pre class="err">${errLines.length ? escapeHtml(errLines.join('\n')) : '(目前沒有錯誤，讚！)'}</pre>

    <h2>📋 一般 Log (最後 ${maxLines} 行，最新在最下方)</h2>
    <pre id="mainlog">${escapeHtml(outLines.join('\n'))}</pre>
    <script>document.getElementById('mainlog').scrollIntoView({ block: 'end' });</script>
</body>
</html>`;
}

function start(config, store) {
  const app = express();
  const port = process.env.PORT || 3001;

  app.get('/', (req, res) => {
    res.set('Content-Type', 'text/html; charset=utf-8');
    res.send(renderStatusPage(config, store));
  });
  app.get('/logs', (req, res) => {
    res.set('Content-Type', 'text/html; charset=utf-8');
    res.send(renderLogsPage(req.query.lines));
  });
  // 測試錯誤通報鏈 (僅內網可達)：觸發一筆錯誤 log，約 30 秒後管理者私聊應收到通報
  app.get('/test-error', (req, res) => {
    console.error(`🧪 [測試] 錯誤通報鏈測試 (${new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' })})`);
    res.send('已觸發測試錯誤，約 30 秒後管理者私聊應收到 🚨 通報 (若 10 分鐘內已通報過則會延後)');
  });

  app.listen(port, () => console.log(`✅ Web Server listening on port ${port}`));
}

module.exports = { start };
