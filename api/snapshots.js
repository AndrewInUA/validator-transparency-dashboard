import { createClient } from "@supabase/supabase-js";

function missingEnvVars(keys) {
  return keys.filter(k => {
    const v = process.env[k];
    return !v || !String(v).trim();
  });
}

function snapshotDayKeyUtc(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatCsvDateUtc(iso) {
  const key = snapshotDayKeyUtc(iso);
  return key || "";
}

function csvEscape(value) {
  const s = value == null ? "" : String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function collapseSnapshotsToDaily(rows) {
  const byDay = new Map();
  for (const row of rows) {
    const key = snapshotDayKeyUtc(row?.captured_at);
    if (!key) continue;
    byDay.set(key, row);
  }
  return [...byDay.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([, row]) => row);
}

async function fetchAllSnapshotRows(supabase, vote, totalCount) {
  const batchSize = 1000;
  const all = [];
  let offset = 0;

  while (offset < totalCount) {
    const end = Math.min(offset + batchSize - 1, totalCount - 1);
    const { data, error } = await supabase
      .from("validator_snapshots")
      .select("status, commission, uptime, sw_apy, tr_apy, pools, captured_at")
      .eq("vote_key", vote)
      .order("captured_at", { ascending: true })
      .range(offset, end);

    if (error) throw error;
    all.push(...(data || []));
    offset += batchSize;
  }

  return all;
}

function buildDailySnapshotCsv(vote, rows) {
  const daily = collapseSnapshotsToDaily(rows);
  const lines = [
    "date_utc,status,commission_pct,voting_consistency_pct,stake_pools,sw_apy,tr_apy,captured_at"
  ];

  for (const row of daily) {
    lines.push(
      [
        csvEscape(formatCsvDateUtc(row.captured_at)),
        csvEscape(row.status ?? ""),
        csvEscape(row.commission ?? ""),
        csvEscape(row.uptime ?? ""),
        csvEscape(row.pools ?? ""),
        csvEscape(row.sw_apy ?? ""),
        csvEscape(row.tr_apy ?? ""),
        csvEscape(row.captured_at ?? "")
      ].join(",")
    );
  }

  return { csv: lines.join("\n"), rowCount: daily.length, vote };
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
    const format = String(req.query.format || "").trim().toLowerCase();
    const includeAllStats =
      String(req.query.include_all_stats || "").trim().toLowerCase() === "1";
    const limitRaw = Number(req.query.limit || 240);
    const limit = Number.isFinite(limitRaw)
      ? Math.max(1, Math.min(limitRaw, 500))
      : 240;

    if (!vote) {
      return res.status(400).json({ error: "Missing vote parameter" });
    }

    if (format === "csv") {
      const { count: totalCount, error: countErr } = await supabase
        .from("validator_snapshots")
        .select("id", { count: "exact", head: true })
        .eq("vote_key", vote);

      if (countErr) {
        console.error("snapshots CSV count error:", countErr);
        return res.status(500).json({ error: "Failed to load snapshot count" });
      }

      if (!totalCount) {
        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="validator-${vote.slice(0, 8)}-daily-snapshots.csv"`
        );
        return res
          .status(200)
          .send("date_utc,status,commission_pct,voting_consistency_pct,stake_pools,sw_apy,tr_apy,captured_at\n");
      }

      try {
        const rows = await fetchAllSnapshotRows(supabase, vote, totalCount);
        const { csv } = buildDailySnapshotCsv(vote, rows);
        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="validator-${vote.slice(0, 8)}-daily-snapshots.csv"`
        );
        return res.status(200).send(csv);
      } catch (err) {
        console.error("snapshots CSV export error:", err);
        return res.status(500).json({ error: "Failed to export snapshots" });
      }
    }

    const [
      { count: totalCount, error: countErr },
      { data: oldestRow, error: oldestErr },
      { data: newestRow, error: newestErr },
      { data: windowRows, error: windowErr }
    ] = await Promise.all([
      supabase
        .from("validator_snapshots")
        .select("id", { count: "exact", head: true })
        .eq("vote_key", vote),
      supabase
        .from("validator_snapshots")
        .select("captured_at")
        .eq("vote_key", vote)
        .order("captured_at", { ascending: true })
        .limit(1),
      supabase
        .from("validator_snapshots")
        .select("captured_at")
        .eq("vote_key", vote)
        .order("captured_at", { ascending: false })
        .limit(1),
      supabase
        .from("validator_snapshots")
        .select("id, vote_key, status, commission, uptime, sw_apy, tr_apy, pools, captured_at")
        .eq("vote_key", vote)
        .order("captured_at", { ascending: false })
        .limit(limit)
    ]);

    if (countErr || oldestErr || newestErr || windowErr) {
      const err = countErr || oldestErr || newestErr || windowErr;
      console.error("snapshots GET error:", err);
      return res.status(500).json({ error: "Failed to load snapshots" });
    }

    const rows = windowRows || [];
    const snapshotsChrono = [...rows].reverse();

    const oldestAt = oldestRow?.[0]?.captured_at ?? null;
    const newestAt = newestRow?.[0]?.captured_at ?? null;

    let allTimeStats = null;
    if (includeAllStats && typeof totalCount === "number" && totalCount > 0) {
      let delinquentCount = 0;
      let commissionChanges = 0;
      let prevCommission = null;
      let hasPrevCommission = false;
      let prevStatus = null;
      let hasPrevStatus = false;
      const commissionChangeEvents = [];
      const statusChangeEvents = [];
      const MAX_EVENTS = 40;

      try {
        const rows = await fetchAllSnapshotRows(supabase, vote, totalCount);
        for (const row of rows) {
          if (row?.status && row.status !== "healthy") delinquentCount++;

          const c = Number(row?.commission);
          if (Number.isFinite(c)) {
            if (hasPrevCommission && prevCommission !== c) {
              commissionChanges++;
              if (commissionChangeEvents.length < MAX_EVENTS) {
                commissionChangeEvents.push({
                  from: prevCommission,
                  to: c,
                  captured_at: row?.captured_at || null
                });
              }
            }
            prevCommission = c;
            hasPrevCommission = true;
          }

          const status = String(row?.status || "").toLowerCase();
          if (status) {
            if (hasPrevStatus && prevStatus !== status) {
              if (statusChangeEvents.length < MAX_EVENTS) {
                statusChangeEvents.push({
                  from: prevStatus,
                  to: status,
                  captured_at: row?.captured_at || null
                });
              }
            }
            prevStatus = status;
            hasPrevStatus = true;
          }
        }
      } catch (err) {
        console.error("snapshots all-time stats error:", err);
        return res.status(500).json({ error: "Failed to load all-time snapshot stats" });
      }

      allTimeStats = {
        sample_count: totalCount,
        delinquent_count: delinquentCount,
        commission_changes: commissionChanges,
        commission_change_events: commissionChangeEvents,
        status_change_events: statusChangeEvents
      };
    }

    return res.status(200).json({
      ok: true,
      vote,
      count: snapshotsChrono.length,
      meta: {
        total_count: typeof totalCount === "number" ? totalCount : 0,
        oldest_captured_at: oldestAt,
        newest_captured_at: newestAt,
        all_time: allTimeStats
      },
      snapshots: snapshotsChrono
    });
  } catch (err) {
    console.error("snapshots handler error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}
