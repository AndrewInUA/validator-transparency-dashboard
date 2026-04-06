function hasEnv(name) {
  const v = process.env[name];
  return !!(v && String(v).trim());
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Intentionally returns only presence flags, never secret values.
  res.setHeader("Cache-Control", "no-store");
  return res.status(200).json({
    ok: true,
    signals: {
      alpha: hasEnv("HELIUS_API_KEY"),
      bravo: hasEnv("SUPABASE_URL"),
      charlie: hasEnv("SUPABASE_SERVICE_ROLE_KEY"),
      delta: hasEnv("CRON_SECRET")
    }
  });
}
