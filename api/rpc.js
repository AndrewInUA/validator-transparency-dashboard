export default async function handler(req, res) {
  const { vote } = req.query;

  if (!vote) {
    return res.status(400).json({ error: "Missing vote account" });
  }

  const RPC = process.env.SOLANA_RPC;  // Set in Vercel environment variables

  try {
    const body = {
      jsonrpc: "2.0",
      id: 1,
      method: "getVoteAccounts",
      params: [{ commitment: "finalized" }]
    };

    const rpcRes = await fetch(RPC, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    });

    const json = await rpcRes.json();

    const all = [
      ...(json.result?.current || []),
      ...(json.result?.delinquent || [])
    ];

    const me = all.find(v => v.votePubkey === vote);

    return res.status(200).json({
      ok: !!me,
      data: me || null
    });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      error: e.message
    });
  }
}
