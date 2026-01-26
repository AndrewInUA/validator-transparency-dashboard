// /api/ratings.js
// Vercel Serverless Function
//
// GET /api/ratings?vote=<VOTE_PUBKEY>
// Returns: normalized APY sources + stake pool presence (from Trillium) + a derived median APY.

function withTimeout(ms, promise) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Timeout after ${ms}ms`)), ms)
    ),
  ]);
}

function toNumber(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function median(nums) {
  const a = nums.filter((x) => Number.isFinite(x)).slice().sort((x, y) => x - y);
  if (!a.length) return null;
  const mid = Math.floor(a.length / 2);
  return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
}

async function fetchJson(url) {
  const res = await withTimeout(
    8000,
    fetch(url, {
      headers: { accept: "application/json" },
      // prevent edge caching surprises
      cache: "no-store",
    })
  );
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return res.json();
}

// ──────────────────────────────────────────────
// Trillium (FIXED)
// We use the endpoint you showed in the browser:
//
// https://api.trillium.so/recency_weighted_average_validator_rewards
//
// It returns an ARRAY of objects for many validators.
// We find the row where vote_account_pubkey === vote.
// ──────────────────────────────────────────────

async function fetchTrillium(vote) {
  const url = "https://api.trillium.so/recency_weighted_average_validator_rewards";

  const raw = await fetchJson(url);

  // Expected: array of validator rows
  if (!Array.isArray(raw)) {
    throw new Error("Trillium response is not an array");
  }

  const row = raw.find((r) => r && r.vote_account_pubkey === vote) || null;
  if (!row) {
    return { latest: null, stakePools: null };
  }

  const stakePoolsObj =
    row.stake_pools && typeof row.stake_pools === "object" ? row.stake_pools : null;

  const stakePools = stakePoolsObj
    ? Object.entries(stakePoolsObj)
        .map(([name, sol]) => ({ name, sol: toNumber(sol) }))
        .filter((x) => x.sol !== null)
        .sort((a, b) => b.sol - a.sol)
    : null;

  // ✅ IMPORTANT:
  // Use "average_delegator_total_apy" (this is the correct total APY for delegators)
  // Also keep "total_overall_apy" for backward compatibility with your UI if needed.
  const delegatorTotal = toNumber(row.average_delegator_total_apy);
  const overallTotal = toNumber(row.average_total_overall_apy);

  return {
    latest: {
      // New preferred field (frontend can use this)
      average_delegator_total_apy: delegatorTotal,

      // Backward-compatible field used by your current app.js (fallback)
      total_overall_apy: overallTotal,

      // extra breakdowns (optional but useful)
      average_delegator_inflation_apy: toNumber(row.average_delegator_inflation_apy),
      average_delegator_mev_apy: toNumber(row.average_delegator_mev_apy),

      average_total_inflation_apy: toNumber(row.average_total_inflation_apy),
      average_total_mev_apy: toNumber(row.average_total_mev_apy),

      total_from_stake_pools: toNumber(row.total_from_stake_pools),
      total_not_from_stake_pools: toNumber(row.total_not_from_stake_pools),

      identity_pubkey: row.identity_pubkey || row.identity || null,
      vote_account_pubkey: row.vote_account_pubkey || null,
    },
    stakePools,
  };
}

// ──────────────────────────────────────────────
// Stakewiz
// ──────────────────────────────────────────────

async function fetchStakewiz(vote) {
  const url = `https://api.stakewiz.com/validator/${vote}`;
  const j = await fetchJson(url);

  return {
    rank: toNumber(j.rank),
    is_jito: !!j.is_jito,
    apy_estimate: toNumber(j.apy_estimate),
    staking_apy: toNumber(j.staking_apy),
    jito_apy: toNumber(j.jito_apy),
    total_apy: toNumber(j.total_apy),
  };
}

module.exports = async (req, res) => {
  try {
    const vote = String(req.query.vote || "").trim();
    if (!vote) {
      res.status(400).json({ error: "Missing ?vote=" });
      return;
    }

    // Avoid caching in Vercel/CDN so APY doesn't "stick"
    res.setHeader("Cache-Control", "no-store");

    const out = {
      vote,
      sources: {
        stakewiz: null,
        trillium: null,
      },
      pools: {
        total_from_stake_pools: null,
        total_not_from_stake_pools: null,
        stake_pools: null, // list [{name, sol}]
      },
      derived: {
        apy_values: [],
        apy_median: null,
        apy_min: null,
        apy_max: null,
      },
      meta: {
        updated_at: new Date().toISOString(),
      },
    };

    // Fetch in parallel
    const [stakewiz, trillium] = await Promise.allSettled([
      fetchStakewiz(vote),
      fetchTrillium(vote),
    ]);

    // Stakewiz
    if (stakewiz.status === "fulfilled") {
      out.sources.stakewiz = stakewiz.value;
      if (Number.isFinite(stakewiz.value?.total_apy)) {
        out.derived.apy_values.push(stakewiz.value.total_apy);
      }
    } else {
      out.sources.stakewiz = { error: String(stakewiz.reason?.message || stakewiz.reason) };
    }

    // Trillium
    if (trillium.status === "fulfilled") {
      out.sources.trillium = trillium.value.latest;
      out.pools.total_from_stake_pools = trillium.value.latest?.total_from_stake_pools ?? null;
      out.pools.total_not_from_stake_pools = trillium.value.latest?.total_not_from_stake_pools ?? null;
      out.pools.stake_pools = trillium.value.stakePools;

      // ✅ Put Trillium delegator total APY into the median basket (preferred)
      if (Number.isFinite(trillium.value.latest?.average_delegator_total_apy)) {
        out.derived.apy_values.push(trillium.value.latest.average_delegator_total_apy);
      } else if (Number.isFinite(trillium.value.latest?.total_overall_apy)) {
        // fallback (still better than nothing)
        out.derived.apy_values.push(trillium.value.latest.total_overall_apy);
      }
    } else {
      out.sources.trillium = { error: String(trillium.reason?.message || trillium.reason) };
    }

    const vals = out.derived.apy_values.filter((x) => Number.isFinite(x));
    out.derived.apy_median = median(vals);
    out.derived.apy_min = vals.length ? Math.min(...vals) : null;
    out.derived.apy_max = vals.length ? Math.max(...vals) : null;

    res.status(200).json(out);
  } catch (err) {
    res.status(500).json({ error: String(err?.message || err) });
  }
};
