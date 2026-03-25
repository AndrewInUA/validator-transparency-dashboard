// /api/ratings.js
// Vercel Serverless Function
//
// GET /api/ratings?vote=<VOTE_PUBKEY>
// Returns: normalized APY sources + stake pool presence (from Trillium) + a derived median APY.
//
// Drop-in update:
// - keeps frontend compatibility with app.js
// - makes Stakewiz handling stricter and more honest
// - avoids false “OK” when Stakewiz returns incomplete data
// - adds a light fallback chain for APY fields
// - adds note/debug fields for easier troubleshooting

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
      cache: "no-store",
    })
  );

  if (!res.ok) {
    throw new Error(`${url} -> HTTP ${res.status}`);
  }

  return res.json();
}

// ──────────────────────────────────────────────
// Trillium
// ──────────────────────────────────────────────

async function fetchTrillium(vote) {
  const url = "https://api.trillium.so/recency_weighted_average_validator_rewards";
  const raw = await fetchJson(url);

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

  const delegatorTotal = toNumber(row.average_delegator_total_apy);
  const overallTotal = toNumber(row.average_total_overall_apy);

  return {
    latest: {
      average_delegator_total_apy: delegatorTotal,
      total_overall_apy: overallTotal,

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

function pickStakewizTotalApy(j) {
  if (!j || typeof j !== "object") return null;

  const candidates = [
    j.total_apy,
    j.apy_estimate,
    j.staking_apy,
  ];

  for (const c of candidates) {
    const n = toNumber(c);
    if (n !== null) return n;
  }

  return null;
}

async function fetchStakewiz(vote) {
  const url = `https://api.stakewiz.com/validator/${vote}`;
  const j = await fetchJson(url);

  if (!j || typeof j !== "object" || Array.isArray(j)) {
    throw new Error("Stakewiz returned an invalid payload");
  }

  const totalApy = pickStakewizTotalApy(j);

  // Important:
  // We treat missing APY as a source failure for this dashboard,
  // because the frontend uses total_apy to decide whether Stakewiz is usable.
  if (!Number.isFinite(totalApy)) {
    throw new Error("Stakewiz APY not available");
  }

  return {
    rank: toNumber(j.rank),
    is_jito: !!j.is_jito,
    apy_estimate: toNumber(j.apy_estimate),
    staking_apy: toNumber(j.staking_apy),
    jito_apy: toNumber(j.jito_apy),
    total_apy: totalApy,
  };
}

// ──────────────────────────────────────────────
// Handler
// ──────────────────────────────────────────────

module.exports = async (req, res) => {
  try {
    const vote = String(req.query.vote || "").trim();

    if (!vote) {
      res.status(400).json({ error: "Missing ?vote=" });
      return;
    }

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
        stake_pools: null,
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
      out.sources.stakewiz = {
        error: String(stakewiz.reason?.message || stakewiz.reason),
        note: "Stakewiz API may be unavailable or returned incomplete data",
      };
    }

    // Trillium
    if (trillium.status === "fulfilled") {
      out.sources.trillium = trillium.value.latest;
      out.pools.total_from_stake_pools =
        trillium.value.latest?.total_from_stake_pools ?? null;
      out.pools.total_not_from_stake_pools =
        trillium.value.latest?.total_not_from_stake_pools ?? null;
      out.pools.stake_pools = trillium.value.stakePools;

      if (Number.isFinite(trillium.value.latest?.average_delegator_total_apy)) {
        out.derived.apy_values.push(trillium.value.latest.average_delegator_total_apy);
      } else if (Number.isFinite(trillium.value.latest?.total_overall_apy)) {
        out.derived.apy_values.push(trillium.value.latest.total_overall_apy);
      }
    } else {
      out.sources.trillium = {
        error: String(trillium.reason?.message || trillium.reason),
      };
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
