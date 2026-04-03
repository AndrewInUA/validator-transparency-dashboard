import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function isProbablyVoteKey(value) {
  if (!value || typeof value !== "string") return false;
  const v = value.trim();
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(v);
}

function getVoteFromRequest(req) {
  if (req.method === "GET") {
    return String(req.query.vote || "").trim();
  }

  if (req.body && typeof req.body === "object") {
    return String(req.body.vote || "").trim();
  }

  try {
    const parsed =
      typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
    return String(parsed.vote || "").trim();
  } catch {
    return "";
  }
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    if (!["GET", "POST"].includes(req.method)) {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const vote = getVoteFromRequest(req);

    if (!vote) {
      return res.status(400).json({ error: "Missing vote parameter" });
    }

    if (!isProbablyVoteKey(vote)) {
      return res.status(400).json({ error: "Invalid vote account format" });
    }

    const nowIso = new Date().toISOString();

    const { data: existing, error: selectError } = await supabase
      .from("tracked_validators")
      .select("vote_key, request_count, is_active")
      .eq("vote_key", vote)
      .maybeSingle();

    if (selectError) {
      throw selectError;
    }

    if (existing) {
      const nextCount = Number(existing.request_count || 0) + 1;

      const { error: updateError } = await supabase
        .from("tracked_validators")
        .update({
          last_requested_at: nowIso,
          request_count: nextCount,
          is_active: true
        })
        .eq("vote_key", vote);

      if (updateError) {
        throw updateError;
      }

      return res.status(200).json({
        ok: true,
        tracked: true,
        vote_key: vote,
        action: "updated",
        request_count: nextCount,
        is_active: true
      });
    }

    const { error: insertError } = await supabase
      .from("tracked_validators")
      .insert({
        vote_key: vote,
        first_seen_at: nowIso,
        last_requested_at: nowIso,
        request_count: 1,
        is_active: true
      });

    if (insertError) {
      throw insertError;
    }

    return res.status(200).json({
      ok: true,
      tracked: true,
      vote_key: vote,
      action: "inserted",
      request_count: 1,
      is_active: true
    });
  } catch (err) {
    console.error("track-validator error:", err);
    return res.status(500).json({
      error: "Failed to register validator for tracking",
      details: err?.message || "Unknown error"
    });
  }
}
