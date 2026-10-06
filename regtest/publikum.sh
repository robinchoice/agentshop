#!/usr/bin/env bash
# Simulates the audience: N people pay 21 sats each into the agent's account.
# Pays the open invoices of the beamer checkout if it runs, otherwise creates its own.
set -euo pipefail
cd "$(dirname "$0")"
n=${1:-5}
memo="Budget für den Agenten"
dc() { docker compose --env-file ../.env "$@"; }
agent() { dc exec -T bank lncli --network=regtest --macaroonpath=/root/.lit/agent.macaroon "$@"; }
for _ in $(seq "$n"); do
  invoice=$(agent listinvoices --pending_only | jq -r --arg m "$memo" \
    '[.invoices[] | select(.state == "OPEN" and (.memo | startswith($m)))] | first | .payment_request // empty')
  [ -n "$invoice" ] || invoice=$(agent addinvoice --amt 21 --memo "$memo, QR 1" | jq -r .payment_request)
  dc exec -T laden lncli --network=regtest payinvoice --force "$invoice" >/dev/null
  sleep 1
done
dc exec -T bank litcli --network=regtest accounts list | jq '.accounts[] | select(.label == "agent") | {id, current_balance}'
