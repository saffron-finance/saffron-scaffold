# Production service

The included systemd template expects the repository at
`/opt/saffron-scaffold` and a root-readable environment file at
`/etc/saffron-scaffold/rpc.env`.

The environment file should contain:

```dotenv
RPC_ETHEREUM=https://your-provider.example/ethereum
RPC_ARBITRUM=https://your-provider.example/arbitrum
RPC_ROBINHOOD=https://your-provider.example/robinhood
LIFI_API_KEY=your-server-only-key
LIFI_INTEGRATOR=saffron-lifi
ZAP_QUOTES_ENABLED=true
RATE_LIMIT_ZAP_QUOTE_GLOBAL_PER_MIN=60
```

Despite its historical `rpc.env` name, this file is the service's complete
server-only environment. Create it without putting secrets in shell arguments,
set ownership to root, and set mode `0600`. `ZAP_QUOTES_ENABLED=false` is the
operator kill switch; pair deposits and read-only browsing continue to work.

Install and start the service:

```bash
cd /opt/saffron-scaffold
npm ci
npm run build
sudo cp ops/systemd/saffron-scaffold.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now saffron-scaffold.service
```

The service binds to `127.0.0.1:3200`. Put an HTTPS reverse proxy in front of
it and forward static requests, `/rpc/<chain>`, `/fixed-vaults/<chain>`, and
`/zaps/quote` to that port. Keep the environment file out of the repository and
restrict it to root. Do not log request headers on the server-to-LI.FI hop.
