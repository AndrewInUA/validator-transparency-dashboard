/**
 * /api/collect.js
 *
 * Auto-collection endpoint — called automatically every 30 minutes by Supabase cron.
 * Fetches live validator data from Solana RPC + ratings APIs, saves snapshot to Supabase.
 *
 * Protected by a secret token so only the cron job can trigger it.
 * GET /api/collect?secret=vtd_cron_secret_2024
 */

const SUPABASE_URL = "https://cprhamfdqomprdgrqlcw.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNwcmhhbWZkcW9tcHJkZ3JxbGN3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUxMzE1MzQsImV4cCI6MjA5MDcwNzUzNH0.4v2E_T_PVccQzb1C2hxfaHMSgL7F0F73opqSktFgcTI";
const CRON_SECRET  = "vtd_cron_secret_2024";

const HELIUS_RPC   = "https://mainnet.helius-rpc.com/?api-key=REDACTED";
const JITO_PROXY   = "https://validator-transparency-dashboard.vercel.app/api/jito";
const RATINGS_BASE = "https://validator-transparency-dashboard.vercel.app/api/ratings";

// The validators to collect — add more vote keys here any time
const VALIDATORS = [
  { voteKey: "3QPGLackJy5LKctYYoPGmA4P8ncyE197jdxr1zP2ho8K", name: "AndrewInUA" }
];

// ── helpers ──────────────────────────────────────
function pickTrilliumApy(t) {
  if (!t) return null;
  for (const c of [t.average_delegator_total_apy, t.delegator_total_apy, t.total_overall_apy]) {
    const n = Number(c);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

async function fetchWithTimeout(url, opts = {}, ms = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// ── fetch live data for one validator ────────────
async function collectOne(voteKey) {
  const RPCS = [
    HELIUS_RPC,
    "https://api.mainnet-beta.solana.com",
    "https://rpc.ankr.com/solana"
  ];

  let status = "error", commission = null, uptime = null;

  for (const rpc of RPCS) {
    try {
      const res = await fetchWithTimeout(rpc, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getVoteAccounts", params: [{ commitment: "finalized" }] })
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      const current    = json?.result?.current   || [];
      const delinquent = json?.result?.delinquent || [];
      const me = [...current, ...delinquent].find(v => v.votePubkey === voteKey);
      if (!me) { status = "not found"; break; }

      commission = Number(me.commission ?? 0);
      status = delinquent.some(v => v.votePubkey === voteKey) ? "delinquent" : "healthy";

      // compute uptime from epochCredits
      try {
        const credits = Array.isArray(me.epochCredits) ? me.epochCredits : [];
        const deltas  = [];
        for (let i = 1; i < credits.length; i++) {
          deltas.push(Math.max(0, (credits[i]?.[1] ?? 0) - (credits[i-1]?.[1] ?? 0)));
        }
        const recent = deltas.slice(-30);
        if (recent.length) {
          const maxD = Math.max(...recent, 1);
          const series = recent.map(d => (d / maxD) * 100);
          const last5  = series.slice(-5);
          uptime = last5.length
            ? Math.round(last5.reduce((s, x) => s + x, 0) / last5.length * 100) / 100
            : null;
        }
      } catch {}
      break;
    } catch (err) {
      console.warn("RPC failed:", rpc, err.message);
    }
  }

  // Jito status
  let jito = false;
  try {
    const jitoRes = await fetchWithTimeout(`${JITO_PROXY}?vote=${encodeURIComponent(voteKey)}`);
    if (jitoRes.ok) jito = !!(await jitoRes.json()).jito;
  } catch {}

  // APY
  let sw_apy = null, tr_apy = null, pools = null;
  try {
    const ratRes = await fetchWithTimeout(`${RATINGS_BASE}?vote=${encodeURIComponent(voteKey)}`);
    if (ratRes.ok) {
      const r = await ratRes.json();
      sw_apy = Number(r?.sources?.stakewiz?.total_apy);
      tr_apy = pickTrilliumApy(r?.sources?.trillium);
      pools  = Array.isArray(r?.pools?.stake_pools) ? r.pools.stake_pools.length : null;
      if (!Number.isFinite(sw_apy)) sw_apy = null;
      if (!Number.isFinite(tr_apy)) tr_apy = null;
    }
  } catch {}

  return { vote_key: voteKey, status, commission, uptime, sw_apy, tr_apy, pools };
}

// ── save snapshot to Supabase ─────────────────────
async function saveSnapshot(snap) {
  const res = await fetchWithTimeout(`${SUPABASE_URL}/rest/v1/validator_snapshots`, {
    method: "POST",
    headers: {
      "apikey":        SUPABASE_KEY,
      "Authorization": `Bearer ${SUPABASE_KEY}`,
      "Content-Type":  "application/json",
      "Prefer":        "return=minimal"
    },
    body: JSON.stringify(snap)
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Supabase insert failed: ${res.status} ${text}`);
  }
}

// ── main handler ──────────────────────────────────
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");

  // Security check
  const secret = req.query.secret || req.headers["x-cron-secret"];
  if (secret !== CRON_SECRET) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const results = [];

  for (const v of VALIDATORS) {
    try {
      console.log(`Collecting snapshot for ${v.name} (${v.voteKey})…`);
      const snap = await collectOne(v.voteKey);
      await saveSnapshot(snap);
      console.log(`✓ Saved: status=${snap.status} commission=${snap.commission} uptime=${snap.uptime}`);
      results.push({ validator: v.name, success: true, data: snap });
    } catch (err) {
      console.error(`✗ Failed for ${v.name}:`, err.message);
      results.push({ validator: v.name, success: false, error: err.message });
    }
  }

  return res.status(200).json({
    collected_at: new Date().toISOString(),
    results
  });
}
