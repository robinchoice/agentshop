export type Item = {
  id: string;
  name: string;
  sats: number;
  usd: string;
  content: () => unknown;
};

const quotes = [
  "„Wenn du mir nicht glaubst oder es nicht verstehst, habe ich keine Zeit, dich zu überzeugen.“ – Satoshi Nakamoto",
  "„Das Problem mit konventionellem Geld ist das Vertrauen, das nötig ist, damit es funktioniert.“ – Satoshi Nakamoto",
  "„Lightning ist kein Layer 2 für Bitcoin. Lightning ist Bitcoin, nur schneller.“ – unbekannt",
  "„HTTP 402: Payment Required. Reserved for future use.“ – RFC 2068, 1997",
];

export const catalog: Item[] = [
  {
    id: "zitat",
    name: "Zitat",
    sats: 5,
    usd: "$0.005",
    content: () => ({ zitat: quotes[Math.floor(Math.random() * quotes.length)] }),
  },
  {
    id: "meme",
    name: "Meme fürs Meetup",
    sats: 21,
    usd: "$0.021",
    content: () => ({
      meme: [
        "Agent:       „Darf ich das kaufen?“",
        "Budget:      „Ja.“",
        "Höchstpreis: „Nein.“",
      ].join("\n"),
    }),
  },
  {
    id: "report",
    name: "Premium-Report",
    sats: 210,
    usd: "$0.21",
    content: () => ({
      report: "Agentic Payments, Oktober 2026",
      punkte: [
        "x402 spricht seit dem 23.09. auch Lightning (Scheme exact/lnbtc).",
        "L402 verkauft einen Token, x402 eine einzelne Anfrage.",
        "Der Unterschied liegt im Zugangsmodell, nicht mehr im Asset.",
      ],
    }),
  },
];
