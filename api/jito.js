// Vercel serverless function: /api/jito?vote=<VOTE_PUBKEY>
// Returns: { jito: true|false, matched: <string|null>, count: <number> }

export default async function handler(req, res) {
  // CORS (allow GitHub Pages to call this)
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const vote = (req.query.vote || "").trim();
  if (!vote) return res.status(400).json({ error: "Missing vote param" });

  // Jito validators list (mainnet)
  const JITO_URL = "https://mainnet.block-engine.jito.wtf/api/v1/validators";

  try {
    const r = await fetch(JITO_URL, { headers: { accept: "application/json" } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const list = await r.json();

    // Normalize & search by a few likely field names
    const keyOf = (obj) =>
      obj?.vote_identity ||
      obj?.voteIdentity ||
      obj?.vote_identity_pubkey ||
      obj?.voteIdentityPubkey ||
      obj?.vote_identity_pubkey_str ||
      obj?.voteIdentityPubkeyStr ||
      obj?.votePubkey ||
      null;

    let found = null;
    let count = 0;
    if (Array.isArray(list)) {
      count = list.length;
      found = list.find((v) => String(keyOf(v) || "").trim() === vote) || null;
    } else if (Array.isArray(list?.validators)) {
      count = list.validators.length;
      found = list.validators.find((v) => String(keyOf(v) || "").trim() === vote) || null;
    }

    res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=300");
    return res.status(200).json({
      jito: !!found,
      matched: found ? keyOf(found) : null,
      count
    });
  } catch (e) {
    return res.status(200).json({ jito: false, matched: null, count: 0, error: "proxy_error" });
  }
}
