import { createClient } from "@supabase/supabase-js";

function missingEnvVars(keys) {
  return keys.filter(k => {
    const v = process.env[k];
    return !v || !String(v).trim();
  });
}

function buildRpcConfig() {
  const key = String(process.env.HELIUS_API_KEY || "").trim();
  if (key) {
    return {
      rpcUrl: `https://mainnet.helius-rpc.com/?api-key=${key}`,
      source: "helius"
    };
  }
  return {
    rpcUrl: "https://api.mainnet-beta.solana.com",
    source: "public_fallback"
  };
}

function computeUptimeFromEpochCredits(epochCredits) {
  if (!Array.isArray(epochCredits) || epochCredits.length < 2) {
    return null;
  }

  try {
    const last = epochCredits[epochCredits.length - 1];
    const prev = epochCredits[epochCredits.length - 2];

    const creditsNow = Number(last?.[1] ?? 0);
    const creditsPrev = Number(prev?.[1] ?? 0);
    const maxCredits = Number(last?.[2] ?? 0);

    if (!Number.isFinite(creditsNow) || !Number.isFinite(creditsPrev)) {
      return null;
    }

    if (!Number.isFinite(maxCredits) || maxCredits <= 0) {
      return null;
    }

    const earned = Math.max(0, creditsNow - creditsPrev);
    const pct = (earned / maxCredits) * 100;

    return Number.isFinite(pct) ? Math.round(pct * 100) / 100 : null;
  } catch {
    return null;
  }
}

async function fetchVoteAccounts(rpcUrl) {
  const rpcRes = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "getVoteAccounts",
      params: [{ commitment: "finalized" }]
    })
  });

  if (!rpcRes.ok) {
    throw new Error(`RPC request failed with HTTP ${rpcRes.status}`);
  }

  const json = await rpcRes.json();

  if (json?.error) {
    throw new Error(json.error.message || "RPC returned an error");
  }

  const current = Array.isArray(json?.result?.current) ? json.result.current : [];
  const delinquent = Array.isArray(json?.result?.delinquent)
    ? json.result.delinquent
    : [];

  return { current, delinquent };
}

const TRACKED_UPSERT_CHUNK = 400;
const SNAPSHOT_INSERT_CHUNK = 200;

async function syncTrackedValidators(supabase, allKeys, nowIso) {
  if (allKeys.length === 0) return;

  for (let i = 0; i < allKeys.length; i += TRACKED_UPSERT_CHUNK) {
    const slice = allKeys.slice(i, i + TRACKED_UPSERT_CHUNK);
    const rows = slice.map(vote_key => ({
      vote_key,
      first_seen_at: nowIso,
      last_requested_at: nowIso,
      request_count: 0,
      is_active: true
    }));

    const { error: insErr } = await supabase.from("tracked_validators").upsert(rows, {
      onConflict: "vote_key",
      ignoreDuplicates: true
    });

    if (insErr) {
      throw insErr;
    }
  }

  for (let i = 0; i < allKeys.length; i += TRACKED_UPSERT_CHUNK) {
    const slice = allKeys.slice(i, i + TRACKED_UPSERT_CHUNK);
    const { error: updErr } = await supabase
      .from("tracked_validators")
      .update({ is_active: true, last_requested_at: nowIso })
      .in("vote_key", slice);

    if (updErr) {
      throw updErr;
    }
  }
}

async function insertSnapshotChunks(supabase, rows) {
  let inserted = 0;
  const errors = [];

  async function tryInsert(chunk) {
    const { error } = await supabase.from("validator_snapshots").insert(chunk);
    if (!error) {
      inserted += chunk.length;
      return;
    }
    if (chunk.length === 1) {
      errors.push({
        vote_key: chunk[0]?.vote_key,
        error: error.message
      });
      return;
    }
    const mid = Math.floor(chunk.length / 2);
    await tryInsert(chunk.slice(0, mid));
    await tryInsert(chunk.slice(mid));
  }

  for (let i = 0; i < rows.length; i += SNAPSHOT_INSERT_CHUNK) {
    const chunk = rows.slice(i, i + SNAPSHOT_INSERT_CHUNK);
    await tryInsert(chunk);
  }

  return {
    inserted,
    failed: rows.length - inserted,
    errors_sample: errors.slice(0, 15)
  };
}

export default async function handler(req, res) {
  try {
    if (req.method !== "GET") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const missing = missingEnvVars([
      "SUPABASE_URL",
      "SUPABASE_SERVICE_ROLE_KEY",
      "CRON_SECRET"
    ]);
    if (missing.length) {
      return res.status(500).json({
        error: "Server environment is not configured",
        missing_env: missing
      });
    }

    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    const secret = String(req.query.secret || "").trim();
    const cronHeader = String(req.headers["x-vercel-cron"] || "").trim();
    const isVercelCron = !!cronHeader;

    if (!process.env.CRON_SECRET) {
      return res.status(500).json({ error: "CRON_SECRET is not configured" });
    }

    if (!isVercelCron && secret !== process.env.CRON_SECRET) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const rpc = buildRpcConfig();
    const { current, delinquent } = await fetchVoteAccounts(rpc.rpcUrl);

    const currentMap = new Map(
      current.map(v => [String(v.votePubkey || "").trim(), v])
    );
    const delinquentMap = new Map(
      delinquent.map(v => [String(v.votePubkey || "").trim(), v])
    );

    const allKeys = [
      ...new Set([...currentMap.keys(), ...delinquentMap.keys()].filter(Boolean))
    ];

    const nowIso = new Date().toISOString();

    if (allKeys.length === 0) {
      return res.status(200).json({
        ok: true,
        total: 0,
        network_validators: 0,
        inserted: 0,
        failed: 0,
        message: "No vote accounts returned from RPC",
        trigger_source: isVercelCron ? "vercel_cron" : "manual_secret",
        rpc_source: rpc.source,
        helius_key_present: rpc.source === "helius"
      });
    }

    await syncTrackedValidators(supabase, allKeys, nowIso);

    const rows = [];

    for (const voteKey of allKeys) {
      const validator =
        currentMap.get(voteKey) || delinquentMap.get(voteKey) || null;

      if (!validator) {
        continue;
      }

      const status = currentMap.has(voteKey)
        ? "healthy"
        : delinquentMap.has(voteKey)
          ? "delinquent"
          : "unknown";

      const uptime = computeUptimeFromEpochCredits(validator.epochCredits);

      rows.push({
        vote_key: voteKey,
        captured_at: nowIso,
        status,
        commission: Number.isFinite(Number(validator.commission))
          ? Number(validator.commission)
          : null,
        uptime,
        sw_apy: null,
        tr_apy: null,
        pools: null,
        jito: false
      });
    }

    const { inserted, failed, errors_sample } = await insertSnapshotChunks(
      supabase,
      rows
    );

    return res.status(200).json({
      ok: true,
      total: rows.length,
      network_validators: allKeys.length,
      inserted,
      failed,
      trigger_source: isVercelCron ? "vercel_cron" : "manual_secret",
      rpc_source: rpc.source,
      helius_key_present: rpc.source === "helius",
      snapshot_errors_sample: errors_sample
    });
  } catch (e) {
    console.error("collect error:", e);
    return res.status(500).json({
      error: e?.message || "Unknown error"
    });
  }
}
