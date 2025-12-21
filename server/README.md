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

