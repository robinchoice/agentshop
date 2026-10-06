// Beamer checkout. The page talks to the agent's account via LNC in the browser.
// This server only adds what the bank cannot see: invoices the shop issued that the agent did not pay.
import page from "./index.html";

const ladenUrl = process.env.LADEN_REST_URL ?? "https://localhost:8081";
const macaroonPath = process.env.LADEN_MACAROON;
if (!macaroonPath) throw new Error("LADEN_MACAROON is not set (path to the shop node's readonly or invoice macaroon)");
const macaroon = Buffer.from(await Bun.file(macaroonPath).arrayBuffer()).toString("hex");

// One L402 request makes Aperture issue two invoices for the same item within a second or two.
// Group them and report a group as unpaid only if none of its invoices was settled.
async function unpaidRequests() {
  const res = await fetch(`${ladenUrl}/v1/invoices?reversed=true&num_max_invoices=200`, {
    headers: { "Grpc-Metadata-macaroon": macaroon },
    tls: { rejectUnauthorized: false },
  });
  const { invoices = [] } = (await res.json()) as { invoices?: { state: string; value: string; creation_date: string; r_hash: string }[] };
  const groups: { id: string; sats: number; created: number; settled: boolean }[] = [];
  for (const i of invoices.toSorted((a, b) => Number(a.creation_date) - Number(b.creation_date))) {
    const sats = Number(i.value), created = Number(i.creation_date), settled = i.state === "SETTLED";
    const last = groups.at(-1);
    if (last && last.sats === sats && created - last.created <= 3) last.settled ||= settled;
    else groups.push({ id: i.r_hash, sats, created, settled });
  }
  return groups.filter((g) => !g.settled).map(({ id, sats, created }) => ({ id, sats, created }));
}

const port = Number(process.env.KASSE_PORT ?? 8404);
Bun.serve({
  port,
  development: false,
  routes: {
    "/": page,
    "/api/unpaid": async () => Response.json(await unpaidRequests()),
  },
});
console.log(`Beamer checkout on http://localhost:${port}`);
