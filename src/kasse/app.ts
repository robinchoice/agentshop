import { LightningNodeConnect } from "@lightninglabs/lnc-web";
import qrcode from "qrcode-generator";
import { catalog } from "../catalog";

const DEPOSIT_SATS = 21;
const INVOICE_EXPIRY_S = 7200;
const MEMO = "Budget für den Agenten";
const ROWS = ["Reihen 1–2", "Reihen 3–4", "Reihen 5–6"];
// lnget pays within a second or two. Older unpaid shop invoices count as refused purchases.
const REFUSED_AFTER_S = 8;

type Till = { request: string; renewAt: number; preimage?: string };
type Entry = { key: string; time: number; text: string; sats: number; kind: "in" | "out" | "refused" };

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const lnc = new LightningNodeConnect({ namespace: "agentshop-kasse", allowPasskeys: false });

let tills: Till[] = [];
let sturz = false;
const seen = new Set<string>();
let ledgerRendered = false;
let unpaidAvailable = false;

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
  return { request: res.paymentRequest, renewAt: Date.now() + (INVOICE_EXPIRY_S - 30) * 1000 };
}

function renderTills() {
  $("tills").innerHTML = tills
    .map((t, i) => `<div class="till">
      <div class="qr">${qrSvg(t.request)}${t.preimage ? `<div class="paid"><b>Bezahlt</b><span>Eure Quittung, der Preimage:</span><code>${t.preimage.slice(0, 32)}…</code></div>` : ""}</div>
      <p>QR ${i + 1}<span>${ROWS[i]}</span></p>
    </div>`)
    .join("");
}

function renderFootRight() {
  const cap = localStorage.getItem("kasse-cap") ?? "50";
  $("footRight").innerHTML = sturz
    ? `Rest <b id="rest">${$("balance").textContent}</b> geht an OpenSats`
    : `Höchstpreis pro Kauf <input id="cap" inputmode="numeric" value="${cap}" aria-label="Höchstpreis pro Kauf in sats">`;
  $<HTMLInputElement>("cap")?.addEventListener("input", (e) => localStorage.setItem("kasse-cap", (e.target as HTMLInputElement).value));
}

async function poll() {
  const [balance, { invoices }, { payments }, unpaid] = await Promise.all([
    lnc.lnd.lightning.channelBalance(),
    lnc.lnd.lightning.listInvoices({ numMaxInvoices: "1000", reversed: true }),
    lnc.lnd.lightning.listPayments({ includeIncomplete: false }),
    fetch("/api/unpaid").then((r) => {
      if (!r.ok) throw new Error(`Shop invoice lookup failed: HTTP ${r.status}`);
      return r.json() as Promise<{ id: string; sats: number; created: number }[]>;
    }).catch((err) => {
      console.error(err);
      return null;
    }),
  ]);

  const settled = invoices.filter((i) => i.state === ("SETTLED" as never) && i.memo.startsWith(MEMO));
  const bought = payments.filter((p) => p.status === ("SUCCEEDED" as never));
  const now = Date.now() / 1000;

  const entries: Entry[] = [
    ...settled.map((i) => ({ key: i.paymentRequest, time: Number(i.settleDate), text: `Einzahlung über ${i.memo.split(", ")[1] ?? "QR"}`, sats: Number(i.value), kind: "in" as const })),
    ...bought.map((p) => ({ key: p.paymentHash, time: Number(p.creationDate), text: `Agent kauft ${itemName(Number(p.valueSat))} per L402`, sats: Number(p.valueSat), kind: "out" as const })),
    ...(unpaid ?? [])
      .filter((u) => now - u.created > REFUSED_AFTER_S)
      .map((u) => ({ key: u.id, time: u.created, text: `${itemName(u.sats)} angefragt, nicht bezahlt (${u.sats} sats)`, sats: 0, kind: "refused" as const })),
  ].sort((a, b) => b.time - a.time);

  const bal = Number(balance.localBalance?.sat ?? balance.balance);
  const paidIn = settled.reduce((s, i) => s + Number(i.value), 0);
  $("balance").textContent = fmt(bal);
  $("paidIn").textContent = fmt(paidIn);
  $("payers").textContent = String(settled.length);
  $("spent").textContent = fmt(bought.reduce((s, p) => s + Number(p.valueSat), 0));
  if ($("rest")) $("rest").textContent = fmt(bal);

  const phase = sturz ? 2 : entries.some((e) => e.kind !== "in") ? 1 : 0;
  $("phases").innerHTML = ["Einzahlen", "Agent kauft ein", "Kassensturz"].map((p, i) => `<span class="${i === phase ? "on" : ""}">${p}</span>`).join("")
    + (unpaid === null ? `<span class="offline">Anfragen des Ladens nicht verfügbar</span>` : "");

  const firstRender = !ledgerRendered;
  $("ledger").innerHTML =
    entries
      .slice(0, 16)
      .map((e) => {
        const fresh = !firstRender && (e.kind !== "refused" || unpaidAvailable) && !seen.has(e.key);
        const amt = e.kind === "refused" ? "–" : `${e.kind === "in" ? "+" : "−"}${fmt(e.sats)}`;
        return `<tr class="${e.kind === "refused" ? "refused" : ""} ${fresh ? "new" : ""}"><td class="time">${clock(e.time)}</td><td>${e.text}</td><td class="amt ${e.kind}">${amt}</td></tr>`;
      })
      .join("") || `<tr><td class="time"></td><td>Noch keine Buchung. Scannt einen QR-Code links.</td><td></td></tr>`;
  entries.forEach((e) => seen.add(e.key));
  ledgerRendered = true;
  unpaidAvailable = unpaid !== null;

  // Show the preimage on paid tills, then replace them with a fresh invoice.
  await Promise.all(tills.map(async (till, i) => {
    const paid = settled.find((s) => s.paymentRequest === till.request);
    if (paid && !till.preimage) {
      till.preimage = toHex(paid.rPreimage as string);
      till.renewAt = Date.now() + 4000;
      renderTills();
    }
    if (Date.now() >= till.renewAt) {
      try {
        tills[i] = await newInvoice(i);
        renderTills();
      } catch (err) {
        console.error(err);
        if (!$("phases").querySelector(".till-offline")) $("phases").insertAdjacentHTML("beforeend", `<span class="offline till-offline">QR-Rechnungen konnten nicht erneuert werden</span>`);
      }
    }
  }));
}

async function loop() {
  try {
    await poll();
  } catch (err) {
    console.error(err);
    if (!$("phases").querySelector(".account-offline")) $("phases").insertAdjacentHTML("beforeend", `<span class="offline account-offline">Verbindung zum Konto unterbrochen</span>`);
  }
  setTimeout(loop, 2000);
}

async function start() {
  $("login").hidden = true;
  $("kasse").hidden = false;
  tills = await Promise.all(ROWS.map((_, i) => newInvoice(i)));
  renderTills();
  renderFootRight();
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
    if (phrase) await lnc.pair(phrase, { method: "password", password });
    else await lnc.login({ method: "password", password });
    await start();
  } catch (err) {
    $("loginError").textContent = `Verbindung fehlgeschlagen: ${(err as Error).message}`;
  }
});

const auth = await lnc.getAuthenticationInfo();
if (auth.hasActiveSession) {
  await lnc.login({ method: "session" }).then(start, () => ($("login").hidden = false));
} else {
  if (auth.hasStoredCredentials) {
    $("phraseLabel").hidden = true;
    $("loginHint").textContent = "Gespeicherte Verbindung gefunden. Passwort eingeben.";
  }
  $("login").hidden = false;
}
