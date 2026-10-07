# agentshop

## Purpose & links

- Demo shop for the workshop "Agentic Payments: x402 vs. L402": an agent buys items with L402 (Lightning via Aperture) or x402 (USDC on Base Sepolia). Public: `robinchoice/agentshop`.
- Runs locally on regtest with Docker (`regtest/`), not deployed. Workshop notes: `~/dev/robin-work/lehre/agentic-payments/`.

## Checks

`bun run typecheck`. For changes to the checkout flows, run the regtest demo from the README end to end.

## Deploy

None. Pushing to `main` only publishes the code.

## Pitfalls

- Item content and the beamer checkout (`src/kasse/`) are German, the workshop runs in German.
- `:8401` (`/l402/<item>`) leaves payment to Aperture and must only be reachable through it.
- `.env` holds `X402_PAY_TO` and stays out of git.
