// Optional PM2 configuration for the standalone Saffron Scaffold server.
module.exports = {
  apps: [
    {
      name: 'saffron-scaffold',
      script: 'server/proxy.mjs',
      instances: 1,
      autorestart: true,
      max_memory_restart: '200M',
      env: {
        NODE_ENV: 'production',
        PORT: '3200',
        // Bound to all interfaces for now; set BIND_HOST=127.0.0.1 once nginx fronts it.
      },
      error_file: 'logs/saffron-scaffold.err.log',
      out_file: 'logs/saffron-scaffold.out.log',
      time: true,
    },
  ],
}
