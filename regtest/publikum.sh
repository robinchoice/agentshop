#!/usr/bin/env bash
# Simulates the audience: N people pay 21 sats each into the agent's account.
set -euo pipefail
cd "$(dirname "$0")"
n=${1:-5}
dc() { docker compose --env-file ../.env "$@"; }
for _ in $(seq "$n"); do
  invoice=$(dc exec -T bank lncli --network=regtest --macaroonpath=/root/.lit/agent.macaroon \
    addinvoice --amt 21 --memo "Budget fuer den Agenten" | jq -r .payment_request)
  dc exec -T laden lncli --network=regtest payinvoice --force "$invoice" >/dev/null
done
dc exec -T bank litcli --network=regtest accounts list | jq '.accounts[] | select(.label == "agent") | {id, current_balance}'
