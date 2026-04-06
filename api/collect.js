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

    if (!process.env.CRON_SECRET) {
      return res.status(500).json({ error: "CRON_SECRET is not configured" });
    }

    if (secret !== process.env.CRON_SECRET) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { data: validators, error: vError } = await supabase
      .from("tracked_validators")
      .select("vote_key")
      .eq("is_active", true)
      .order("last_requested_at", { ascending: false });

    if (vError) {
      return res.status(500).json({ error: vError.message });
    }

    if (!validators || validators.length === 0) {
      return res.status(200).json({
        ok: true,
        total: 0,
        inserted: 0,
        failed: 0,
        message: "No validators to track",
        results: []
      });
    }

    const rpc = buildRpcConfig();
    const { current, delinquent } = await fetchVoteAccounts(rpc.rpcUrl);

    const currentMap = new Map(current.map(v => [v.votePubkey, v]));
    const delinquentMap = new Map(delinquent.map(v => [v.votePubkey, v]));

    const nowIso = new Date().toISOString();
    const results = [];

    for (const item of validators) {
      const voteKey = String(item.vote_key || "").trim();

      if (!voteKey) {
        results.push({
          vote_key: voteKey,
          ok: false,
          error: "Missing vote_key"
        });
        continue;
      }

      try {
        const validator =
          currentMap.get(voteKey) || delinquentMap.get(voteKey) || null;

        if (!validator) {
          results.push({
            vote_key: voteKey,
            ok: false,
            error: "Validator not found in vote accounts"
          });
          continue;
        }

        const status = currentMap.has(voteKey)
          ? "healthy"
          : delinquentMap.has(voteKey)
            ? "delinquent"
            : "unknown";

        const uptime = computeUptimeFromEpochCredits(validator.epochCredits);

        const row = {
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
        };

        const { error: insertError } = await supabase
          .from("validator_snapshots")
          .insert(row);

        if (insertError) {
          results.push({
            vote_key: voteKey,
            ok: false,
            error: insertError.message
          });
          continue;
        }

        results.push({
          vote_key: voteKey,
          ok: true,
          status,
          uptime
        });
      } catch (e) {
        results.push({
          vote_key: voteKey,
          ok: false,
          error: e?.message || "Unknown error"
        });
      }
    }

    const inserted = results.filter(r => r.ok).length;
    const failed = results.length - inserted;

    return res.status(200).json({
      ok: true,
      total: validators.length,
      inserted,
      failed,
      rpc_source: rpc.source,
      helius_key_present: rpc.source === "helius",
      results
    });
  } catch (e) {
    return res.status(500).json({
      error: e?.message || "Unknown error"
    });
  }
}
