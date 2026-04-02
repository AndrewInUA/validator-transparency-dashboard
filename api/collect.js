import { createClient } from "@supabase/supabase-js";

const HELIUS_RPC =
  process.env.HELIUS_RPC_URL ||
  "https://api.mainnet-beta.solana.com";

const JITO_PROXY_BASE =
  process.env.SITE_URL
    ? `${process.env.SITE_URL}/api/jito`
    : "https://validator-transparency-dashboard.vercel.app/api/jito";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const FALLBACK_VALIDATORS = [
  {
    voteKey: "3QPGLackJy5LKctYYoPGmA4P8ncyE197jdxr1zP2ho8K"
  }
];

async function getTrackedValidators() {
  const limitRaw = Number(process.env.TRACKED_VALIDATORS_LIMIT || 100);
  const limit = Number.isFinite(limitRaw)
    ? Math.max(1, Math.min(limitRaw, 1000))
    : 100;

  const { data, error } = await supabase
    .from("tracked_validators")
    .select("vote_key")
    .eq("is_active", true)
    .order("last_requested_at", { ascending: false })
    .limit(limit);

  if (error) {
    throw error;
  }

  const validators = (data || [])
    .map((v) => ({
      voteKey: String(v.vote_key || "").trim()
    }))
    .filter((v) => v.voteKey);

  return validators.length ? validators : FALLBACK_VALIDATORS;
}

async function fetchVoteAccounts() {
  const body = {
    jsonrpc: "2.0",
    id: 1,
    method: "getVoteAccounts",
    params: [{ commitment: "finalized" }]
  };

  const res = await fetch(HELIUS_RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    throw new Error(`Vote accounts fetch failed: HTTP ${res.status}`);
  }

  return res.json();
}

function computeEpochConsistencySeries(epochCredits) {
  const credits = Array.isArray(epochCredits) ? epochCredits : [];
  const deltas = [];

  for (let i = 1; i < credits.length; i++) {
    deltas.push(
      Math.max(0, (credits[i]?.[1] ?? 0) - (credits[i - 1]?.[1] ?? 0))
    );
  }

  const recent = deltas.slice(-30);
  if (!recent.length) return [];

  const maxD = Math.max(...recent, 1);
  return recent.map((d) => Math.round((d / maxD) * 10000) / 100);
}

function computeUptimePct(series) {
  const last5 = series.slice(-5);
  if (!last5.length) return null;
  return (
    Math.round(
      (last5.reduce((sum, value) => sum + value, 0) / last5.length) * 100
    ) / 100
  );
}

async function fetchJitoStatus(voteKey) {
  try {
    const url = `${JITO_PROXY_BASE}?vote=${encodeURIComponent(voteKey)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    return !!json?.jito;
  } catch (err) {
    console.warn("Jito fetch failed for", voteKey, err.message);
    return false;
  }
}

async function snapshotForValidator(voteKey, voteAccountsJson) {
  const current = voteAccountsJson?.result?.current || [];
  const delinquent = voteAccountsJson?.result?.delinquent || [];
  const me = [...current, ...delinquent].find((v) => v.votePubkey === voteKey);

  if (!me) {
    return {
      vote_key: voteKey,
      status: "not found",
      commission: null,
      uptime: null,
      sw_apy: null,
      tr_apy: null,
      pools: null,
      jito: false,
      captured_at: new Date().toISOString()
    };
  }

  const isDelinquent = delinquent.some((v) => v.votePubkey === me.votePubkey);
  const commission = Number.isFinite(Number(me.commission))
    ? Number(me.commission)
    : null;
  const series = computeEpochConsistencySeries(me.epochCredits);
  const uptime = computeUptimePct(series);
  const jito = await fetchJitoStatus(voteKey);

  return {
    vote_key: voteKey,
    status: isDelinquent ? "delinquent" : "healthy",
    commission,
    uptime,
    sw_apy: null,
    tr_apy: null,
    pools: null,
    jito,
    captured_at: new Date().toISOString()
  };
}

async function insertSnapshot(row) {
  const { error } = await supabase.from("validator_snapshots").insert(row);

  if (error) {
    throw error;
  }
}

export default async function handler(req, res) {
  try {
    const secret = String(req.query.secret || "");
    if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const validators = await getTrackedValidators();
    const voteAccountsJson = await fetchVoteAccounts();

    const results = [];

    for (const validator of validators) {
      try {
        const row = await snapshotForValidator(
          validator.voteKey,
          voteAccountsJson
        );
        await insertSnapshot(row);

        results.push({
          vote_key: validator.voteKey,
          ok: true,
          status: row.status,
          captured_at: row.captured_at
        });
      } catch (err) {
        console.error("Collect failed for", validator.voteKey, err);
        results.push({
          vote_key: validator.voteKey,
          ok: false,
          error: err.message || "Unknown error"
        });
      }
    }

    return res.status(200).json({
      ok: true,
      collected: results.filter((r) => r.ok).length,
      total: results.length,
      results
    });
  } catch (err) {
    console.error("collect handler error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}
