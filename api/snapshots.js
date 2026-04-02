/**
 * /api/snapshots.js
 * Vercel serverless function — read & write validator snapshots to Supabase
 *
 * GET  /api/snapshots?vote=<voteKey>&limit=120   → returns array of snapshots
 * POST /api/snapshots                             → saves one snapshot (JSON body)
 */

const SUPABASE_URL = "https://cprhamfdqomprdgrqlcw.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNwcmhhbWZkcW9tcHJkZ3JxbGN3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUxMzE1MzQsImV4cCI6MjA5MDcwNzUzNH0.4v2E_T_PVccQzb1C2hxfaHMSgL7F0F73opqSktFgcTI";

const HEADERS = {
  "apikey":        SUPABASE_KEY,
  "Authorization": `Bearer ${SUPABASE_KEY}`,
  "Content-Type":  "application/json",
  "Prefer":        "return=minimal"
};

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();

  // ── GET: fetch snapshot history for a vote key ──
  if (req.method === "GET") {
    const voteKey = (req.query.vote || "").trim();
    const limit   = Math.min(Number(req.query.limit) || 120, 500);

    if (!voteKey) return res.status(400).json({ error: "Missing ?vote= param" });

    try {
      const url = `${SUPABASE_URL}/rest/v1/validator_snapshots`
        + `?vote_key=eq.${encodeURIComponent(voteKey)}`
        + `&order=captured_at.desc`
        + `&limit=${limit}`;

      const r = await fetch(url, { headers: HEADERS });
      if (!r.ok) throw new Error(`Supabase error: ${r.status}`);
      const rows = await r.json();
      return res.status(200).json(rows.reverse()); // oldest first
    } catch (err) {
      console.error("GET snapshots error:", err);
      return res.status(500).json({ error: err.message });
    }
  }

  // ── POST: save one snapshot ──
  if (req.method === "POST") {
    try {
      const body = req.body || {};
      const voteKey = (body.vote_key || "").trim();
      if (!voteKey) return res.status(400).json({ error: "Missing vote_key" });

      // Rate-limit: check if a snapshot was already saved in the last 25 minutes
      const cutoff = new Date(Date.now() - 25 * 60 * 1000).toISOString();
      const checkUrl = `${SUPABASE_URL}/rest/v1/validator_snapshots`
        + `?vote_key=eq.${encodeURIComponent(voteKey)}`
        + `&captured_at=gt.${encodeURIComponent(cutoff)}`
        + `&limit=1`;

      const checkRes = await fetch(checkUrl, { headers: HEADERS });
      if (checkRes.ok) {
        const recent = await checkRes.json();
        if (recent.length > 0) {
          return res.status(200).json({ skipped: true, reason: "Too recent" });
        }
      }

      // Insert snapshot
      const payload = {
        vote_key:   voteKey,
        status:     body.status     ?? null,
        commission: body.commission ?? null,
        uptime:     body.uptime     ?? null,
        sw_apy:     body.sw_apy     ?? null,
        tr_apy:     body.tr_apy     ?? null,
        pools:      body.pools      ?? null
      };

      const insertRes = await fetch(`${SUPABASE_URL}/rest/v1/validator_snapshots`, {
        method:  "POST",
        headers: HEADERS,
        body:    JSON.stringify(payload)
      });

      if (!insertRes.ok) {
        const text = await insertRes.text();
        throw new Error(`Insert failed: ${insertRes.status} ${text}`);
      }

      return res.status(200).json({ saved: true });
    } catch (err) {
      console.error("POST snapshots error:", err);
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}
