// Vercel serverless function: /api/jito?vote=<VOTE_PUBKEY>
// Uses official Jito validator API (no API key required).
// Docs: https://kobe.mainnet.jito.network/api/v1/validators

export default async function handler(req, res) {
  // Allow calls from your GitHub Pages dashboard
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const vote = (req.query.vote || "").trim();
  if (!vote) {
    return res.status(400).json({ error: "missing_vote_param" });
  }

  const JITO_URL = "https://kobe.mainnet.jito.network/api/v1/validators";

  try {
    // Simple GET; you can also POST with { epoch } but default is "latest"
    const r = await fetch(JITO_URL, {
      method: "GET",
      headers: { accept: "application/json" },
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);

    const data = await r.json();

    // According to docs, shape is { validators: [...] }
    const validators = Array.isArray(data?.validators)
      ? data.validators
      : Array.isArray(data)
      ? data
      : [];

    const found = validators.find(
      (v) => String(v.vote_account || "").trim() === vote
    );

    const runningJito = !!(found && found.running_jito);

    res.setHeader(
      "Cache-Control",
      "s-maxage=60, stale-while-revalidate=300"
    );

    return res.status(200).json({
      jito: runningJito,          // what your dashboard cares about
      in_set: !!found,            // is this vote key present at all
      running_jito: runningJito,  // explicit flag
      mev_commission_bps: found?.mev_commission_bps ?? null,
      priority_fee_commission_bps: found?.priority_fee_commission_bps ?? null,
      active_stake: found?.active_stake ?? null,
      count: validators.length,
    });
  } catch (e) {
    // On any error we fall back to "unknown / off"
    return res.status(200).json({
      jito: false,
      matched: null,
      count: 0,
      error: "proxy_error",
      message: e.message,
    });
  }
}
