// Minimal x402 buyer for the demo, the x402 counterpart to lnget.
// Usage: bun src/x402get.ts <url> [--max-cost '$0.10']
import { parseArgs } from "node:util";
import { wrapFetchWithPayment, x402Client, decodePaymentResponseHeader } from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { privateKeyToAccount } from "viem/accounts";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { "max-cost": { type: "string", default: "$0.10" } },
});
const url = positionals[0];
const key = process.env.EVM_PRIVATE_KEY as `0x${string}` | undefined;
if (!url || !key) {
  console.error("usage: EVM_PRIVATE_KEY=0x… bun src/x402get.ts <url> [--max-cost '$0.10']");
  process.exit(1);
}

const decode = (header: string) => JSON.parse(Buffer.from(header, "base64").toString());

const account = privateKeyToAccount(key);
const client = new x402Client()
  .register("eip155:84532", new ExactEvmScheme(account))
  .onBeforePaymentCreation(async ({ paymentRequired }) => {
    console.error("← 402 Payment Required");
    console.error(JSON.stringify(paymentRequired.accepts, null, 2));
  })
  .setSpendControls({ maxAmountPerPayment: values["max-cost"]! });

try {
  const res = await wrapFetchWithPayment(fetch, client)(url);
  const receipt = res.headers.get("PAYMENT-RESPONSE");
  if (receipt) {
    const settled = decodePaymentResponseHeader(receipt);
    console.error(`→ paid by ${account.address}`);
    console.error(`  https://sepolia.basescan.org/tx/${settled.transaction}`);
  }
  if (!res.ok) {
    const required = res.headers.get("PAYMENT-REQUIRED");
    console.error(`✗ ${res.status} ${required ? decode(required).error : res.statusText}`);
    process.exit(3);
  }
  console.log(JSON.stringify(await res.json(), null, 2));
} catch (err) {
  const message = (err as Error).message;
  console.error(`✗ ${message}`);
  // Same exit codes as lnget: 2 = price above the cap.
  process.exit(message.includes("spendControls") ? 2 : 1);
}
