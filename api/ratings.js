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
  const res = await withTimeout(8000, fetch(url, { headers: { accept: "application/json" } }));
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return res.json();
}

// Trillium docs show stake_pools + total_overall_apy fields.
// Endpoints listed include:
// - https://api.trillium.so/validator_rewards/<pubkey>
// - https://api.trillium.so/ten_epoch_validator_rewards/<pubkey>
// - https://api.trillium.so/recency_weighted_average_validator_rewards/<pubkey>
// We'll try "ten_epoch" first (light aggregation), then fallback to "validator_rewards". :contentReference[oaicite:1]{index=1}
async function fetchTrillium(vote) {
  const base = "https://api.trillium.so";

  const tries = [
    `${base}/ten_epoch_validator_rewards/${vote}`,
    `${base}/validator_rewards/${vote}`,
  ];

  let raw = null;
  let lastErr = null;

  for (const url of tries) {
    try {
      raw = await fetchJson(url);
      break;
    } catch (e) {
      lastErr = e;
    }
  }

  if (!raw) throw lastErr || new Error("Trillium fetch failed");

  // Trillium may return:
  // - array of epoch records (last 10 epochs)
  // - object with data array
  // We’ll normalize: pick the "latest" record as raw[0] if array, else first item in known array fields.
  let latest = null;

  if (Array.isArray(raw)) {
    latest = raw[0] || null;
  } else if (raw && Array.isArray(raw.data)) {
    latest = raw.data[0] || null;
  } else if (raw && Array.isArray(raw.results)) {
    latest = raw.results[0] || null;
  } else if (raw && typeof raw === "object") {
    // Sometimes it might already be a single record
    latest = raw;
  }

  if (!latest) return { latest: null, stakePools: null };

  const stakePoolsObj = latest.stake_pools && typeof latest.stake_pools === "object"
    ? latest.stake_pools
    : null;

  const stakePools = stakePoolsObj
    ? Object.entries(stakePoolsObj)
        .map(([name, sol]) => ({ name, sol: toNumber(sol) }))
        .filter((x) => x.sol !== null)
        .sort((a, b) => b.sol - a.sol)
    : null;

  return {
    latest: {
      total_overall_apy: toNumber(latest.total_overall_apy),
      total_inflation_apy: toNumber(latest.total_inflation_apy),
      total_mev_apy: toNumber(latest.total_mev_apy),
      total_from_stake_pools: toNumber(latest.total_from_stake_pools),
      total_not_from_stake_pools: toNumber(latest.total_not_from_stake_pools),
      identity_pubkey: latest.identity_pubkey || latest.identity || null,
      vote_account_pubkey: latest.vote_account_pubkey || latest.vote_identity || null,
    },
    stakePools,
  };
}

// Stakewiz: friend gave endpoint https://api.stakewiz.com/validator/<VOTE>
// We'll use that and pick total_apy / staking_apy / jito_apy if present.
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

    if (stakewiz.status === "fulfilled") {
      out.sources.stakewiz = stakewiz.value;
      if (Number.isFinite(stakewiz.value?.total_apy)) {
        out.derived.apy_values.push(stakewiz.value.total_apy);
      }
    } else {
      out.sources.stakewiz = { error: String(stakewiz.reason?.message || stakewiz.reason) };
    }

    if (trillium.status === "fulfilled") {
      out.sources.trillium = trillium.value.latest;
      out.pools.total_from_stake_pools = trillium.value.latest?.total_from_stake_pools ?? null;
      out.pools.total_not_from_stake_pools = trillium.value.latest?.total_not_from_stake_pools ?? null;
      out.pools.stake_pools = trillium.value.stakePools;

      if (Number.isFinite(trillium.value.latest?.total_overall_apy)) {
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
