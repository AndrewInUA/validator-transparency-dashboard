import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function isLikelyVoteKey(value) {
  const v = String(value || "").trim();
  return v.length >= 32 && v.length <= 60;
}

export default async function handler(req, res) {
  try {
    if (req.method !== "GET" && req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const vote = String(req.query.vote || req.body?.vote || "").trim();

    if (!vote) {
      return res.status(400).json({ error: "Missing vote parameter" });
    }

    if (!isLikelyVoteKey(vote)) {
      return res.status(400).json({ error: "Invalid vote parameter" });
    }

    const now = new Date().toISOString();

    const { data: existing, error: readError } = await supabase
      .from("tracked_validators")
      .select("vote_key, request_count")
      .eq("vote_key", vote)
      .maybeSingle();

    if (readError) {
      throw readError;
    }

    if (existing) {
      const { error: updateError } = await supabase
        .from("tracked_validators")
        .update({
          last_requested_at: now,
          request_count: Number(existing.request_count || 0) + 1,
          is_active: true
        })
        .eq("vote_key", vote);

      if (updateError) {
        throw updateError;
      }

      return res.status(200).json({
        ok: true,
        tracked: true,
        existed: true,
        vote_key: vote
      });
    }

    const { error: insertError } = await supabase
      .from("tracked_validators")
      .insert({
        vote_key: vote,
        first_seen_at: now,
        last_requested_at: now,
        request_count: 1,
        is_active: true
      });

    if (insertError) {
      throw insertError;
    }

    return res.status(200).json({
      ok: true,
      tracked: true,
      existed: false,
      vote_key: vote
    });
  } catch (err) {
    console.error("track-validator error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}
