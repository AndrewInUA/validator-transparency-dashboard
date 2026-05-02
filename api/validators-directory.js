/**
 * GET /api/validators-directory?q=&limit=
 * Proxies Stakewiz full validator list (names + vote accounts) with short server cache.
 * Lets users search without pasting a full vote key.
 */

let cache = { at: 0, rows: null };
const CACHE_MS = 8 * 60 * 1000;

function normalizeRow(v) {
  const vote = String(v.vote_identity || "").trim();
  const stake = Number(v.activated_stake);
  return {
    vote,
    name: typeof v.name === "string" ? v.name.trim() : "",
    commission: Number.isFinite(Number(v.commission)) ? Number(v.commission) : null,
    stake_sol: Number.isFinite(stake) ? stake : null,
    delinquent: !!v.delinquent,
    rank: Number.isFinite(Number(v.rank)) ? Number(v.rank) : null
  };
}

async function loadStakewizList() {
  const now = Date.now();
  if (cache.rows && now - cache.at < CACHE_MS) {
    return cache.rows;
  }

  const res = await fetch("https://api.stakewiz.com/validators", {
    headers: { accept: "application/json" },
    cache: "no-store"
  });

  if (!res.ok) {
    throw new Error(`Stakewiz validators HTTP ${res.status}`);
  }

  const json = await res.json();
  const raw = Array.isArray(json) ? json : [];
  cache.rows = raw.map(normalizeRow).filter(r => r.vote.length >= 32);
  cache.at = now;
  return cache.rows;
}

function filterRows(rows, q, limit) {
  const trimmed = String(q || "").trim();
  const ql = trimmed.toLowerCase();
  let out = rows;

  if (ql.length >= 2) {
    out = rows.filter(r => {
      const name = (r.name || "").toLowerCase();
      const vote = (r.vote || "").toLowerCase();
      return name.includes(ql) || vote.includes(ql);
    });
  } else if (ql.length === 1) {
    out = rows.filter(r => (r.vote || "").toLowerCase().startsWith(ql));
  }

  out = [...out].sort((a, b) => {
    const sa = Number.isFinite(a.stake_sol) ? a.stake_sol : 0;
    const sb = Number.isFinite(b.stake_sol) ? b.stake_sol : 0;
    return sb - sa;
  });

  return out.slice(0, limit);
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const q = String(req.query.q || "").trim();
  const limitRaw = Number(req.query.limit || 50);
  const limit = Math.min(100, Math.max(1, Number.isFinite(limitRaw) ? limitRaw : 50));

  try {
    const all = await loadStakewizList();
    const results = filterRows(all, q, limit);

    res.setHeader("Cache-Control", "public, s-maxage=120, stale-while-revalidate=300");

    return res.status(200).json({
      ok: true,
      q,
      limit,
      total_catalog: all.length,
      returned: results.length,
      source: "stakewiz",
      note:
        "Directory names and stake come from Stakewiz; open a profile to use this dashboard’s snapshot + RPC pipeline.",
      results
    });
  } catch (e) {
    console.error("validators-directory:", e);
    return res.status(500).json({
      ok: false,
      error: e?.message || "Failed to load validator directory"
    });
  }
}
