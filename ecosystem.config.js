module.exports = {
  apps: [
    {
      name: 'house-bot',
      script: 'index.js',
      cwd: __dirname,
      log_date_format: 'YYYY-MM-DD HH:mm:ss', // 每行 log 自動加時間戳（同 stock-bot）
      autorestart: true,
      max_restarts: 10,
      restart_delay: 30000,
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
