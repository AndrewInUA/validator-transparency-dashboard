import fs from "fs";
import path from "path";

const archivePath = path.resolve("data/snapshot-archive.json");

function buildRpcUrl() {
  const key = String(process.env.HELIUS_API_KEY || "").trim();
  if (key) return `https://mainnet.helius-rpc.com/?api-key=${key}`;
  return "https://api.mainnet-beta.solana.com";
}

function utcDay(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

function uptimeFromEpochCredits(epochCredits) {
  if (!Array.isArray(epochCredits) || epochCredits.length < 2) return null;
  const last = epochCredits[epochCredits.length - 1];
  const prev = epochCredits[epochCredits.length - 2];
  const creditsNow = Number(last?.[1] ?? 0);
  const creditsPrev = Number(prev?.[1] ?? 0);
  const maxCredits = Number(last?.[2] ?? 0);
  if (!Number.isFinite(creditsNow) || !Number.isFinite(creditsPrev)) return null;
  if (!Number.isFinite(maxCredits) || maxCredits <= 0) return null;
  const pct = (Math.max(0, creditsNow - creditsPrev) / maxCredits) * 100;
  return Number.isFinite(pct) ? Math.round(pct * 100) / 100 : null;
}

async function fetchVoteAccounts(rpcUrl) {
  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "getVoteAccounts",
      params: [{ commitment: "finalized" }]
    })
  });
  if (!res.ok) throw new Error(`RPC request failed with HTTP ${res.status}`);
  const json = await res.json();
  if (json?.error) throw new Error(json.error.message || "RPC returned an error");
  return {
    current: Array.isArray(json?.result?.current) ? json.result.current : [],
    delinquent: Array.isArray(json?.result?.delinquent) ? json.result.delinquent : []
  };
}

const archive = fs.existsSync(archivePath)
  ? JSON.parse(fs.readFileSync(archivePath, "utf8"))
  : {};

const nowIso = new Date().toISOString();
const today = utcDay(nowIso);
const { current, delinquent } = await fetchVoteAccounts(buildRpcUrl());

const byKey = new Map();
for (const validator of current) {
  const vote = String(validator?.votePubkey || "").trim();
  if (vote) byKey.set(vote, { validator, status: "healthy" });
}
for (const validator of delinquent) {
  const vote = String(validator?.votePubkey || "").trim();
  if (vote && !byKey.has(vote)) byKey.set(vote, { validator, status: "delinquent" });
}

let added = 0;
let skipped = 0;
for (const [vote, { validator, status }] of byKey) {
  const rows = Array.isArray(archive[vote]) ? archive[vote] : [];
  const last = rows[rows.length - 1];
  if (last && utcDay(last[0]) === today) {
    skipped++;
    continue;
  }
  const commission = Number(validator?.commission);
  rows.push([
    nowIso,
    status,
    Number.isFinite(commission) ? commission : null,
    uptimeFromEpochCredits(validator?.epochCredits)
  ]);
  archive[vote] = rows;
  added++;
}

fs.mkdirSync(path.dirname(archivePath), { recursive: true });
fs.writeFileSync(archivePath, JSON.stringify(archive));
console.log(`validators ${byKey.size} added ${added} already_today ${skipped} day ${today}`);
