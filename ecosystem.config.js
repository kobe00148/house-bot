module.exports = {
  apps: [
    {
      name: 'house-bot',
      script: 'index.js',
      cwd: __dirname,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 30000,
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
