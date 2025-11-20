// Vercel serverless function: /api/jito?vote=<VOTE_PUBKEY>
// Returns: { jito: true|false, matched: <string|null>, count: <number> }

export default async function handler(req, res) {
  // Allow calls from your GitHub Pages domain
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const vote = (req.query.vote || "").trim();
  if (!vote) return res.status(400).json({ error: "Missing vote param" });

  const JITO_URL = "https://mainnet.block-engine.jito.wtf/api/v1/validators";

  try {
    const r = await fetch(JITO_URL, { headers: { accept: "application/json" } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);

    const list = await r.json();

    const getKey = (obj) =>
      obj?.vote_identity ||
      obj?.voteIdentity ||
      obj?.vote_identity_pubkey ||
      obj?.voteIdentityPubkey ||
      obj?.vote_identity_pubkey_str ||
      obj?.voteIdentityPubkeyStr ||
      obj?.votePubkey ||
      null;

    let arr = [];
    if (Array.isArray(list)) arr = list;
    else if (Array.isArray(list?.validators)) arr = list.validators;

    const found = arr.find(v => String(getKey(v) || "").trim() === vote) || null;

    res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=300");
    return res.status(200).json({
      jito: !!found,
      matched: found ? getKey(found) : null,
      count: arr.length
    });
  } catch (e) {
    return res.status(200).json({
      jito: false,
      matched: null,
      count: 0,
      error: "proxy_error"
    });
  }
}
