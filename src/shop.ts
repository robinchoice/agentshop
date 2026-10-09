import { Hono } from "hono";
import { paymentMiddleware, x402ResourceServer } from "@x402/hono";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { catalog, network } from "./catalog";

const payTo = process.env.X402_PAY_TO;
const facilitatorUrl = process.env.X402_FACILITATOR_URL ?? "https://x402.org/facilitator";
if (!payTo) throw new Error("X402_PAY_TO is not set");

// x402 checkout: payment is handled in-process by the x402 middleware.
const resourceServer = new x402ResourceServer(
  new HTTPFacilitatorClient({ url: facilitatorUrl }),
).register(network, new ExactEvmScheme());

const x402 = new Hono();
x402.get("/", (c) =>
  c.json(catalog.map(({ id, name, sats, usd }) => ({ id, name, l402: `${sats} sats`, x402: `${usd} USDC` }))),
);
x402.use(
  paymentMiddleware(
    Object.fromEntries(
      catalog.map((item) => [
        `GET /x402/${item.id}`,
        { accepts: [{ scheme: "exact", price: item.usd, network, payTo }], description: item.name },
      ]),
    ),
    resourceServer,
  ),
);

// L402 checkout: only reachable through Aperture, which handles payment.
const l402 = new Hono();
for (const item of catalog) {
  l402.get(`/l402/${item.id}`, (c) => c.json(item.content()));
  x402.get(`/x402/${item.id}`, (c) => c.json(item.content()));
}

const l402Port = Number(process.env.L402_BACKEND_PORT ?? 8401);
const x402Port = Number(process.env.X402_PORT ?? 8403);
Bun.serve({ port: l402Port, fetch: l402.fetch });
Bun.serve({ port: x402Port, fetch: x402.fetch });
console.log(`L402 backend on :${l402Port} (behind Aperture), x402 checkout on :${x402Port}`);
