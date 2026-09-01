# Production service

The included systemd template expects the repository at
`/opt/saffron-liqifi` and a root-readable environment file at
`/etc/saffron-liqifi/rpc.env`.

The environment file should contain:

```dotenv
RPC_ETHEREUM=https://your-provider.example/ethereum
RPC_ARBITRUM=https://your-provider.example/arbitrum
RPC_ROBINHOOD=https://your-provider.example/robinhood
```

Install and start the service:

```bash
cd /opt/saffron-liqifi
npm ci
npm run build
sudo cp ops/systemd/saffron-liqifi.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now saffron-liqifi.service
```

The service binds to `127.0.0.1:3200`. Put an HTTPS reverse proxy in front of
it and forward both static requests and `/rpc/<chain>` requests to that port.
Keep the environment file out of the repository and restrict it to root.
