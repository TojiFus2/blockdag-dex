# Faucet server (dev)

## Run

1) Ensure root `.env` contains:
- `RPC_URL` (or `BDAG_RPC_URL`)
- `PRIVATE_KEY` (signer used to `mint` or `transfer`)

2) Start the server:

```bash
node server/index.js
```

Server listens on `http://localhost:8787`.

## Endpoint

`POST /api/faucet/drip`

Body:

```json
{ "wallet": "0x...", "amount": 100 }
```

Rules:
- `amount` clamped to `1..100`
- 1 claim per 24h per wallet (persisted in `server/claims_1043.json`)

## Pools API (dev / demo)

These endpoints are used by `ui/src/pages/PoolPage.jsx` to persist "user pools" and deposits server-side (persisted in `server/pools_1043.json`).

- `GET /api/pools`
- `POST /api/pools` body: `{ "owner": "0x..." }`
- `POST /api/pools/:id/deposits` body: `{ "wallet": "0x...", "bdagRaw": "123...", "usdcRaw": "456...", "txHash": "0x..." }`
- `POST /api/pools/:id/withdrawals` body: `{ "wallet": "0x...", "bdagRaw": "123...", "usdcRaw": "456...", "txHash": "0x..." }`
