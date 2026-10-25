import { LightningNodeConnect } from "@lightninglabs/lnc-web";
import qrcode from "qrcode-generator";
import { catalog } from "../catalog";

const DEPOSIT_SATS = 21;
const INVOICE_EXPIRY_S = 7200;
const RECEIPT_SHOWN_MS = 4000;
const RENEW_BEFORE_EXPIRY_MS = 30000;
const RENEW_RETRY_MS = 10000;
const MEMO = "Budget für den Agenten";
const ROWS = ["Reihen 1–2", "Reihen 3–4", "Reihen 5–6"];

// open: shows its QR. paid: shows the receipt until it is renewed. unavailable: expired or receipt over, not renewed yet.
// retryAt is set while renewing failed and holds the next attempt.
type Till = { status: "open" | "paid" | "unavailable"; request: string; qr: string; expiresAt: number; paidAt?: number; preimage?: string; retryAt?: number };
type Entry = { key: string; time: number; text: string; sats: number; kind: "in" | "out" | "refused" };

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const lnc = new LightningNodeConnect({ namespace: "agentshop-kasse", allowPasskeys: false });

let tills: Till[] = [];
let sturz = false;
const seen = new Set<string>();
let ledgerRendered = false;
let shopping = false;
let accountAvailable = true;
let unpaidAvailable = true;

// A paid till is renewed and stops showing its QR once the receipt was shown; an unpaid one is renewed shortly before it expires.
const usableUntil = (t: Till) => (t.paidAt === undefined ? t.expiresAt : t.paidAt + RECEIPT_SHOWN_MS);
const renewAt = (t: Till) => (t.paidAt === undefined ? t.expiresAt - RENEW_BEFORE_EXPIRY_MS : t.paidAt + RECEIPT_SHOWN_MS);

const itemName = (sats: number) => catalog.find((i) => i.sats === sats)?.name ?? `${sats} sats`;
const clock = (unix: number) => new Date(unix * 1000).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
const fmt = (n: number) => n.toLocaleString("de-DE");
const toHex = (b64: string) => Array.from(atob(b64), (c) => c.charCodeAt(0).toString(16).padStart(2, "0")).join("");

function qrSvg(request: string) {
  // Uppercase BOLT11 fits the QR alphanumeric mode: fewer modules, readable from the back rows.
  const qr = qrcode(0, "L");
  qr.addData(`LIGHTNING:${request.toUpperCase()}`, "Alphanumeric");
  qr.make();
  return qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
}

async function newInvoice(index: number): Promise<Till> {
  const res = await lnc.lnd.lightning.addInvoice({ value: String(DEPOSIT_SATS), memo: `${MEMO}, QR ${index + 1}`, expiry: String(INVOICE_EXPIRY_S) });
  return { status: "open", request: res.paymentRequest, qr: qrSvg(res.paymentRequest), expiresAt: Date.now() + INVOICE_EXPIRY_S * 1000 };
}

function tillQr(t: Till) {
  if (t.status === "unavailable") return `<div class="unavailable">QR nicht verfügbar</div>`;
  if (t.status === "paid") return `${t.qr}<div class="paid"><b>Bezahlt</b><span>Eure Quittung, der Preimage:</span><code>${t.preimage!.slice(0, 32)}…</code></div>`;
  return t.qr;
}

function renderTills() {
  $("tills").innerHTML = tills
    .map((t, i) => `<div class="till">
      <div class="qr">${tillQr(t)}</div>
      <p>QR ${i + 1}<span>${ROWS[i]}</span>${t.retryAt ? `<span class="offline">QR konnte nicht erneuert werden</span>` : ""}</p>
    </div>`)
    .join("");
}

function renderPhases() {
  const phase = sturz ? 2 : shopping ? 1 : 0;
  const offline = [
    !unpaidAvailable && "Anfragen des Ladens nicht verfügbar",
    tills.some((t) => t.retryAt) && "QR-Rechnungen konnten nicht erneuert werden",
    !accountAvailable && "Verbindung zum Konto unterbrochen",
  ].filter(Boolean);
  $("phases").innerHTML = ["Einzahlen", "Agent kauft ein", "Kassensturz"].map((p, i) => `<span class="${i === phase ? "on" : ""}">${p}</span>`).join("")
    + offline.map((text) => `<span class="offline">${text}</span>`).join("");
}

function renderFootRight() {
  $("purchaseCap").hidden = sturz;
  $("finalTally").hidden = !sturz;
}

const cap = $<HTMLInputElement>("cap");
cap.addEventListener("input", () => localStorage.setItem("kasse-cap", cap.value));

async function poll() {
  const [balance, { invoices }, { payments }, refused] = await Promise.all([
    lnc.lnd.lightning.channelBalance(),
    lnc.lnd.lightning.listInvoices({ numMaxInvoices: "1000", reversed: true }),
    lnc.lnd.lightning.listPayments({ includeIncomplete: false }),
    fetch("/api/refused").then((r) => {
      if (!r.ok) throw new Error(`Shop invoice lookup failed: HTTP ${r.status}`);
      return r.json() as Promise<{ id: string; sats: number; created: number }[]>;
    }).catch((err) => {
      console.error(err);
      return null;
    }),
  ]);

  const settled = invoices.filter((i) => i.state === ("SETTLED" as never) && i.memo.startsWith(MEMO));
  const bought = payments.filter((p) => p.status === ("SUCCEEDED" as never));

  const entries: Entry[] = [
    ...settled.map((i) => ({ key: i.paymentRequest, time: Number(i.settleDate), text: `Einzahlung über ${i.memo.split(", ")[1] ?? "QR"}`, sats: Number(i.value), kind: "in" as const })),
    ...bought.map((p) => ({ key: p.paymentHash, time: Number(p.creationDate), text: `Agent kauft ${itemName(Number(p.valueSat))} per L402`, sats: Number(p.valueSat), kind: "out" as const })),
    ...(refused ?? []).map((u) => ({ key: u.id, time: u.created, text: `${itemName(u.sats)} angefragt, nicht bezahlt (${u.sats} sats)`, sats: 0, kind: "refused" as const })),
  ].sort((a, b) => b.time - a.time);

  const bal = Number(balance.localBalance?.sat ?? balance.balance);
  const paidIn = settled.reduce((s, i) => s + Number(i.value), 0);
  $("balance").textContent = fmt(bal);
  $("paidIn").textContent = fmt(paidIn);
  $("payers").textContent = String(settled.length);
  $("spent").textContent = fmt(bought.reduce((s, p) => s + Number(p.valueSat), 0));
  $("rest").textContent = fmt(bal);

  shopping = entries.some((e) => e.kind !== "in");

  const firstRender = !ledgerRendered;
  $("ledger").innerHTML =
    entries
      .slice(0, 16)
      .map((e) => {
        const fresh = !firstRender && (e.kind !== "refused" || unpaidAvailable) && !seen.has(e.key);
        const amt = e.kind === "refused" ? "–" : `${e.kind === "in" ? "+" : "−"}${fmt(e.sats)}`;
        return `<tr class="${e.kind === "refused" ? "refused" : ""} ${fresh ? "new" : ""}"><td class="time">${clock(e.time)}</td><td></td><td class="amt ${e.kind}">${amt}</td></tr>`;
      })
      .join("") || `<tr><td class="time"></td><td>Noch keine Buchung. Scannt einen QR-Code links.</td><td></td></tr>`;
  entries.slice(0, 16).forEach((e, i) => {
    $("ledger").querySelectorAll("tr")[i]!.children[1]!.textContent = e.text;
  });
  entries.forEach((e) => seen.add(e.key));
  ledgerRendered = true;
  unpaidAvailable = refused !== null;

  // Show the preimage on paid tills, then replace them with a fresh invoice.
  let changed = false;
  for (const till of tills) {
    const paid = settled.find((s) => s.paymentRequest === till.request);
    if (paid && till.paidAt === undefined) {
      till.status = "paid";
      till.paidAt = Date.now();
      till.preimage = toHex(paid.rPreimage as string);
      changed = true;
    }
  }
  if (changed) renderTills();
}

async function renewTills() {
  let changed = false;
  const now = Date.now();
  await Promise.all(tills.map(async (till, i) => {
    if (till.status !== "unavailable" && now >= usableUntil(till)) {
      till.status = "unavailable";
      changed = true;
    }
    if (accountAvailable && now >= renewAt(till) && now >= (till.retryAt ?? 0)) {
      try {
        tills[i] = await newInvoice(i);
        changed = true;
      } catch (err) {
        console.error(err);
        if (!till.retryAt) changed = true;
        till.retryAt = Date.now() + RENEW_RETRY_MS;
      }
    }
  }));
  if (changed) renderTills();
}

async function loop() {
  try {
    await poll();
    accountAvailable = true;
  } catch (err) {
    console.error(err);
    accountAvailable = false;
  }
  await renewTills();
  renderPhases();
  setTimeout(loop, 2000);
}

async function start() {
  tills = await Promise.all(ROWS.map((_, i) => newInvoice(i)));
  $("depositSats").textContent = String(DEPOSIT_SATS);
  renderTills();
  cap.value = localStorage.getItem("kasse-cap") ?? "50";
  renderFootRight();
  $("login").hidden = true;
  $("kasse").hidden = false;
  loop();
}

document.addEventListener("keydown", (e) => {
  if (e.key === "k" && !(e.target instanceof HTMLInputElement)) {
    sturz = !sturz;
    renderFootRight();
  }
});

$("login").addEventListener("submit", async (e) => {
  e.preventDefault();
  const phrase = $<HTMLInputElement>("phrase").value.trim();
  const password = $<HTMLInputElement>("password").value;
  $("loginError").textContent = "";
  try {
    if (!lnc.isConnected) {
      if (phrase) {
        await lnc.pair(phrase, { method: "password", password });
        $<HTMLInputElement>("phrase").value = "";
      } else await lnc.login({ method: "password", password });
    }
    await start();
  } catch (err) {
    $("loginError").textContent = `Verbindung fehlgeschlagen: ${(err as Error).message}`;
  }
});

const auth = await lnc.getAuthenticationInfo();
if (auth.hasActiveSession) {
  try {
    await lnc.login({ method: "session" });
    await start();
  } catch (err) {
    $("loginError").textContent = `Verbindung fehlgeschlagen: ${(err as Error).message}`;
    $("login").hidden = false;
  }
} else {
  if (auth.hasStoredCredentials) {
    $("phraseLabel").hidden = true;
    $("loginHint").textContent = "Gespeicherte Verbindung gefunden. Passwort eingeben.";
  }
  $("login").hidden = false;
}
