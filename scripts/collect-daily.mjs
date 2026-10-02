import fs from "fs";
import path from "path";

const voteDir = path.resolve("data/by-vote");

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

function readRows(vote) {
  const file = path.join(voteDir, `${vote}.json`);
  if (!fs.existsSync(file)) return [];
  const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  return Array.isArray(parsed) ? parsed : [];
}

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
  if (!/^[1-9A-HJ-NP-Za-km-z]+$/.test(vote)) continue;
  const rows = readRows(vote);
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
  fs.mkdirSync(voteDir, { recursive: true });
  fs.writeFileSync(path.join(voteDir, `${vote}.json`), JSON.stringify(rows));
  added++;
}

console.log(`validators ${byKey.size} added ${added} already_today ${skipped} day ${today}`);
