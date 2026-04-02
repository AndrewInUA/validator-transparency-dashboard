import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const HELIUS_RPC =
  "https://mainnet.helius-rpc.com/?api-key=REDACTED";

export default async function handler(req, res) {
  try {
    const secret = String(req.query.secret || "").trim();

    if (secret !== process.env.CRON_SECRET) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    /* 🔥 GET TRACKED VALIDATORS */
    const { data: validators, error: vError } = await supabase
      .from("tracked_validators")
      .select("vote_key")
      .eq("is_active", true);

    if (vError) {
      return res.status(500).json({ error: vError.message });
    }

    if (!validators || validators.length === 0) {
      return res.status(200).json({
        ok: true,
        message: "No validators to track"
      });
    }

    let results = [];

    for (const v of validators) {
      const voteKey = v.vote_key;

      try {
        const rpcRes = await fetch(HELIUS_RPC, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "getVoteAccounts"
          })
        });

        const json = await rpcRes.json();

        const allValidators = [
          ...(json.result?.current || []),
          ...(json.result?.delinquent || [])
        ];

        const validator = allValidators.find(
          (val) => val.votePubkey === voteKey
        );

        if (!validator) {
          results.push({
            vote_key: voteKey,
            ok: false,
            error: "Validator not found"
          });
          continue;
        }

        const uptime =
          validator.epochCredits?.length > 1
            ? 100 *
              (validator.epochCredits.at(-1)[1] -
                validator.epochCredits.at(-2)[1]) /
              (validator.epochCredits.at(-1)[2] || 1)
            : null;

        const row = {
          vote_key: voteKey,
          captured_at: new Date().toISOString(),
          status: validator.activatedStake > 0 ? "healthy" : "delinquent",
          commission: validator.commission,
          uptime: uptime,
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
        } else {
          results.push({
            vote_key: voteKey,
            ok: true
          });
        }
      } catch (e) {
        results.push({
          vote_key: voteKey,
          ok: false,
          error: e.message
        });
      }
    }

    return res.status(200).json({
      ok: true,
      total: validators.length,
      results
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
