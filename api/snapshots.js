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
    const limitRaw = Number(req.query.limit || 120);
    const limit = Number.isFinite(limitRaw)
      ? Math.max(1, Math.min(limitRaw, 500))
      : 120;

    if (!vote) {
      return res.status(400).json({ error: "Missing vote parameter" });
    }

    const { data, error } = await supabase
      .from("validator_snapshots")
      .select("id, vote_key, status, commission, uptime, sw_apy, tr_apy, pools, captured_at")
      .eq("vote_key", vote)
      .order("captured_at", { ascending: true })
      .limit(limit);

    if (error) {
      console.error("snapshots GET error:", error);
      return res.status(500).json({ error: "Failed to load snapshots" });
    }

    return res.status(200).json({
      ok: true,
      vote,
      count: data?.length || 0,
      snapshots: data || []
    });
  } catch (err) {
    console.error("snapshots handler error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}
