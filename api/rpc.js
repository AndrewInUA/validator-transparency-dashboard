export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { vote } = req.query;

  if (!vote) {
    return res.status(400).json({ error: "Missing vote account" });
  }

  const solanaRpc = String(process.env.SOLANA_RPC || "").trim();
  const heliusKey = String(process.env.HELIUS_API_KEY || "").trim();
  const rpcList = [
    solanaRpc || null,
    heliusKey ? `https://mainnet.helius-rpc.com/?api-key=${heliusKey}` : null,
    "https://api.mainnet-beta.solana.com",
    "https://rpc.ankr.com/solana"
  ].filter(Boolean);

  try {
    const body = {
      jsonrpc: "2.0",
      id: 1,
      method: "getVoteAccounts",
      params: [{ commitment: "finalized" }]
    };

    let lastErr = null;

    for (const rpcUrl of rpcList) {
      try {
        const rpcRes = await fetch(rpcUrl, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body)
        });
        if (!rpcRes.ok) throw new Error(`RPC HTTP ${rpcRes.status}`);

        const json = await rpcRes.json();
        if (json?.error) throw new Error(json.error?.message || "RPC returned error");

        const current = Array.isArray(json.result?.current) ? json.result.current : [];
        const delinquent = Array.isArray(json.result?.delinquent)
          ? json.result.delinquent
          : [];
        const all = [...current, ...delinquent];
        const me = all.find(v => v.votePubkey === vote);
        const status = me
          ? current.some(v => v.votePubkey === me.votePubkey)
            ? "healthy"
            : delinquent.some(v => v.votePubkey === me.votePubkey)
              ? "delinquent"
              : "unknown"
          : "not_found";

        return res.status(200).json({
          ok: !!me,
          data: me || null,
          status,
          rpc_source: rpcUrl
        });
      } catch (err) {
        lastErr = err;
      }
    }

    return res.status(502).json({
      ok: false,
      error: "All RPC providers failed",
      details: lastErr?.message || "Unknown RPC error"
    });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      error: e.message
    });
  }
}
