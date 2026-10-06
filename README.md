# agentshop

A tiny shop for AI agents with two checkouts: **L402** (Lightning, via [Aperture](https://github.com/lightninglabs/aperture)) and **x402** (USDC on Base Sepolia, via the [x402 SDK](https://github.com/x402-foundation/x402)). Built for the workshop "Agentic Payments: x402 vs. L402", where an agent goes shopping with a budget the audience pays in.

| Item | L402 | x402 |
|---|---|---|
| `zitat` (quote) | 5 sats | $0.005 |
| `meme` | 21 sats | $0.021 |
| `report` | 210 sats | $0.21 |

Item content is German, the workshop runs in German.

## Pieces

- `src/shop.ts`: the shop. `:8403` serves the catalog and the x402 checkout (`/x402/<item>`). `:8401` serves `/l402/<item>` and is only meant to sit behind Aperture.
- `src/x402get.ts`: x402 buyer, the counterpart to `lnget`. Shows the challenge, pays within `--max-cost`, prints the Basescan link. Exit code 2 when the price is above the cap, like lnget.
- `src/kasse/`: the beamer checkout. Three rotating QR codes pay into the agent's account, next to a live statement of that account: deposits, purchases, and requests the agent did not pay. The page connects to the account via LNC in the browser; the small server adds the shop node's unpaid invoices.
- `regtest/`: the whole demo on regtest with Docker: `bank` (litd holding the agent's account), `laden` (the shop's node), Aperture on `:8402`, the shop on `:8403`.

## Regtest

```bash
bun install
echo "X402_PAY_TO=0x…" > .env      # any address you control on Base Sepolia
regtest/setup.sh                   # nodes, channels, LiT account "agent" (balance 0), LNC pairing phrase
regtest/publikum.sh 5              # five people pay 21 sats into the agent's account
```

Show the beamer checkout. It needs its own LNC session on the account (a pairing phrase works only once):

```bash
docker compose -f regtest/compose.yml --env-file .env exec bank litcli --network=regtest \
  sessions add --label kasse --type account --account_id <account id from setup.sh>
LADEN_MACAROON=regtest/laden-readonly.macaroon bun run kasse   # http://localhost:8404
```

Press `k` on the page to toggle the final tally (Kassensturz).

Buy with [lnget](https://github.com/lightninglabs/lnget), connected via LNC to a session that can only spend from the `agent` account:

```bash
lnget ln lnc pair --stdin            # paste the pairing phrase printed by setup.sh
export LNGET_LN_MODE=lnc LNGET_HTTP_ALLOW_INSECURE=true \
  LNGET_LN_LNC_SESSION_ID=$(lnget ln lnc sessions | jq -r '.[0].id')
lnget -q --max-cost 50 http://localhost:8402/l402/meme     # pays 21 sats
lnget -q --max-cost 50 http://localhost:8402/l402/meme     # cached token, free
lnget -q --max-cost 50 http://localhost:8402/l402/report   # exit 2: above the cap
```

lnget keeps one token per host, so buying another item replaces the cached token. A plain account macaroon does not work with lnget 1.1.0: its version check calls `GetVersion`, which account macaroons may not use.

Buy with x402 (the wallet needs Base Sepolia USDC, e.g. from [faucet.circle.com](https://faucet.circle.com)):

```bash
EVM_PRIVATE_KEY=0x… bun src/x402get.ts http://localhost:8403/x402/meme --max-cost '$0.05'
```

Tear down with `docker compose -f regtest/compose.yml --env-file .env down -v`.

## License

MIT
