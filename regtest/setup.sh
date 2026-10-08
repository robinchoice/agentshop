#!/usr/bin/env bash
# Starts the regtest stack and wires it up like the workshop:
# bank -> laden channel for the agent's purchases, laden -> bank channel for the audience,
# a LiT account "agent" and an LNC session restricted to that account.
set -euo pipefail
cd "$(dirname "$0")"

dc() { docker compose --env-file ../.env "$@"; }
btc() { dc exec -T bitcoind bitcoin-cli -regtest -rpcuser=regtest -rpcpassword=regtest "$@"; }
ln() { local node=$1; shift; dc exec -T "$node" lncli --network=regtest "$@"; }
lit() { dc exec -T bank litcli --network=regtest "$@"; }
mine() { btc -rpcwallet=miner -generate "$1" >/dev/null; }

wait_for() {
  for _ in $(seq 60); do "$@" >/dev/null 2>&1 && return; sleep 2; done
  echo "timeout: $*" >&2; exit 1
}

dc up -d
wait_for ln bank getinfo
wait_for ln laden getinfo

btc createwallet miner >/dev/null 2>&1 || btc loadwallet miner >/dev/null 2>&1 || true
mine 101
for node in bank laden; do
  btc -rpcwallet=miner sendtoaddress "$(ln $node newaddress p2tr | jq -r .address)" 1 >/dev/null
done
mine 6
funded() { [ "$(ln "$1" walletbalance | jq -r .confirmed_balance)" -gt 0 ]; }
wait_for funded bank
wait_for funded laden

bank_id=$(ln bank getinfo | jq -r .identity_pubkey)
ln laden connect "$bank_id@bank:9735" >/dev/null || true
ln bank openchannel --node_key "$(ln laden getinfo | jq -r .identity_pubkey)" --local_amt 1000000 >/dev/null
mine 1
ln laden openchannel --node_key "$bank_id" --local_amt 1000000 >/dev/null
mine 6
channels_active() { [ "$(ln bank listchannels | jq '[.channels[] | select(.active)] | length')" -eq 2 ]; }
wait_for channels_active

wait_for lit accounts list
lit accounts create 0 --label agent --save_to /root/.lit/agent.macaroon >/dev/null
account=$(lit accounts list | jq -r '.accounts[] | select(.label == "agent") | .id')
phrase=$(lit sessions add --label agent --type account --account_id "$account" | jq -r .session.pairing_secret_mnemonic)

# The beamer checkout reads the shop's unpaid invoices with this macaroon.
dc cp laden:/root/.lnd/data/chain/bitcoin/regtest/readonly.macaroon laden-readonly.macaroon >/dev/null

echo "Account agent: $account (balance 0, fill it with regtest/publikum.sh)"
echo "LNC pairing phrase for lnget: $phrase"
