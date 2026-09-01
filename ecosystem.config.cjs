// Optional PM2 configuration for the standalone Saffron LiqiFi server.
module.exports = {
  apps: [
    {
      name: 'saffron-liqifi',
      script: 'server/proxy.mjs',
      instances: 1,
      autorestart: true,
      max_memory_restart: '200M',
      env: {
        NODE_ENV: 'production',
        PORT: '3200',
        // Bound to all interfaces for now; set BIND_HOST=127.0.0.1 once nginx fronts it.
      },
      error_file: 'logs/liqifi.err.log',
      out_file: 'logs/liqifi.out.log',
      time: true,
    },
  ],
}
