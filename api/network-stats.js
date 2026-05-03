/**
 * GET /api/network-stats
 * Returns network-wide medians and percentiles for commission, APY estimate,
 * stake, and pools/delinquency rates. Used to give every metric on the
 * validator profile a "vs network" context line and to power the Verdict
 * Badge ("Recommended / Watch / Wait / Caution").
 *
 * Source: Stakewiz public /validators feed (full network catalog).
 * Cache: 8 minutes in-process to avoid hammering Stakewiz.
 */

let cache = { at: 0, payload: null };
const CACHE_MS = 8 * 60 * 1000;

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function pickApyEstimate(v) {
  const candidates = [v.apy_estimate, v.apy, v.total_apy, v.apy_total];
  for (const c of candidates) {
    const n = Number(c);
    if (Number.isFinite(n) && n > 0 && n < 100) return n;
  }
  return null;
}

function percentile(sorted, p) {
  if (!sorted.length) return null;
  if (sorted.length === 1) return sorted[0];
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  const w = idx - lo;
  return sorted[lo] * (1 - w) + sorted[hi] * w;
}

function summarize(values) {
  const clean = values.filter(v => Number.isFinite(v));
  if (!clean.length) return null;
  const sorted = [...clean].sort((a, b) => a - b);
  return {
    count: clean.length,
    min: sorted[0],
    p10: percentile(sorted, 0.1),
    p25: percentile(sorted, 0.25),
    median: percentile(sorted, 0.5),
    p75: percentile(sorted, 0.75),
    p90: percentile(sorted, 0.9),
    max: sorted[sorted.length - 1],
    mean: clean.reduce((a, b) => a + b, 0) / clean.length
  };
}

async function loadStakewizCatalog() {
  const res = await fetch("https://api.stakewiz.com/validators", {
    headers: { accept: "application/json" },
    cache: "no-store"
  });
  if (!res.ok) throw new Error(`Stakewiz validators HTTP ${res.status}`);
  const json = await res.json();
  return Array.isArray(json) ? json : [];
}

function computePayload(catalog) {
  const commissions = [];
  const apys = [];
  const stakes = [];
  let delinquentCount = 0;
  let activeCount = 0;
  let highCommissionCount = 0;

  for (const v of catalog) {
    const c = num(v.commission);
    const a = pickApyEstimate(v);
    const s = num(v.activated_stake);
    if (c !== null) {
      commissions.push(c);
      if (c >= 80) highCommissionCount += 1;
    }
    if (a !== null) apys.push(a);
    if (s !== null && s > 0) stakes.push(s);
    if (v.delinquent) delinquentCount += 1;
    else activeCount += 1;
  }

  return {
    as_of: new Date().toISOString(),
    validator_count: catalog.length,
    active_count: activeCount,
    delinquent_count: delinquentCount,
    delinquent_pct: catalog.length
      ? (delinquentCount / catalog.length) * 100
      : null,
    high_commission_count: highCommissionCount,
    stats: {
      commission: summarize(commissions),
      apy: summarize(apys),
      stake_sol: summarize(stakes)
    }
  };
}

async function getPayload() {
  const now = Date.now();
  if (cache.payload && now - cache.at < CACHE_MS) return cache.payload;
  const catalog = await loadStakewizCatalog();
  const payload = computePayload(catalog);
  cache = { at: now, payload };
  return payload;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  try {
    const payload = await getPayload();
    res.setHeader("Cache-Control", "public, s-maxage=300, stale-while-revalidate=600");
    return res.status(200).json({
      ok: true,
      source: "stakewiz",
      ...payload
    });
  } catch (e) {
    console.error("network-stats:", e);
    return res.status(500).json({
      ok: false,
      error: e?.message || "Failed to compute network stats"
    });
  }
}
