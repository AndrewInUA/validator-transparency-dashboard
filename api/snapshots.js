import { createClient } from "@supabase/supabase-js";

function missingEnvVars(keys) {
  return keys.filter(k => {
    const v = process.env[k];
    return !v || !String(v).trim();
  });
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    const missing = missingEnvVars(["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]);
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

    if (req.method !== "GET") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const vote = String(req.query.vote || "").trim();
    const includeAllStats =
      String(req.query.include_all_stats || "").trim().toLowerCase() === "1";
    const limitRaw = Number(req.query.limit || 240);
    const limit = Number.isFinite(limitRaw)
      ? Math.max(1, Math.min(limitRaw, 500))
      : 240;

    if (!vote) {
      return res.status(400).json({ error: "Missing vote parameter" });
    }

    const [
      { count: totalCount, error: countErr },
      { data: oldestRow, error: oldestErr },
      { data: newestRow, error: newestErr },
      { data: windowRows, error: windowErr }
    ] = await Promise.all([
      supabase
        .from("validator_snapshots")
        .select("id", { count: "exact", head: true })
        .eq("vote_key", vote),
      supabase
        .from("validator_snapshots")
        .select("captured_at")
        .eq("vote_key", vote)
        .order("captured_at", { ascending: true })
        .limit(1),
      supabase
        .from("validator_snapshots")
        .select("captured_at")
        .eq("vote_key", vote)
        .order("captured_at", { ascending: false })
        .limit(1),
      supabase
        .from("validator_snapshots")
        .select("id, vote_key, status, commission, uptime, sw_apy, tr_apy, pools, captured_at")
        .eq("vote_key", vote)
        .order("captured_at", { ascending: false })
        .limit(limit)
    ]);

    if (countErr || oldestErr || newestErr || windowErr) {
      const err = countErr || oldestErr || newestErr || windowErr;
      console.error("snapshots GET error:", err);
      return res.status(500).json({ error: "Failed to load snapshots" });
    }

    const rows = windowRows || [];
    const snapshotsChrono = [...rows].reverse();

    const oldestAt = oldestRow?.[0]?.captured_at ?? null;
    const newestAt = newestRow?.[0]?.captured_at ?? null;

    let allTimeStats = null;
    if (includeAllStats && typeof totalCount === "number" && totalCount > 0) {
      const batchSize = 1000;
      let offset = 0;
      let delinquentCount = 0;
      let commissionChanges = 0;
      let prevCommission = null;
      let hasPrev = false;

      while (offset < totalCount) {
        const end = Math.min(offset + batchSize - 1, totalCount - 1);
        const { data: chunk, error: chunkErr } = await supabase
          .from("validator_snapshots")
          .select("status, commission")
          .eq("vote_key", vote)
          .order("captured_at", { ascending: true })
          .range(offset, end);

        if (chunkErr) {
          console.error("snapshots all-time stats error:", chunkErr);
          return res.status(500).json({ error: "Failed to load all-time snapshot stats" });
        }

        for (const row of chunk || []) {
          if (row?.status && row.status !== "healthy") delinquentCount++;

          const c = Number(row?.commission);
          if (Number.isFinite(c)) {
            if (hasPrev && prevCommission !== c) commissionChanges++;
            prevCommission = c;
            hasPrev = true;
          }
        }

        offset += batchSize;
      }

      allTimeStats = {
        sample_count: totalCount,
        delinquent_count: delinquentCount,
        commission_changes: commissionChanges
      };
    }

    return res.status(200).json({
      ok: true,
      vote,
      count: snapshotsChrono.length,
      meta: {
        total_count: typeof totalCount === "number" ? totalCount : 0,
        oldest_captured_at: oldestAt,
        newest_captured_at: newestAt,
        all_time: allTimeStats
      },
      snapshots: snapshotsChrono
    });
  } catch (err) {
    console.error("snapshots handler error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}
