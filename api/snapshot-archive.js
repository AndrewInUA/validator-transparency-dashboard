import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

let cache = null;

function archiveFile() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.join(here, "..", "data", "snapshot-archive.json"),
    path.join(process.cwd(), "data", "snapshot-archive.json"),
    path.join(process.cwd(), "snapshot-archive.json")
  ];
  return candidates.find(candidate => fs.existsSync(candidate)) || null;
}

export function loadSnapshotArchive() {
  if (cache) return cache;
  const file = archiveFile();
  cache = file ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
  return cache;
}

export function rowsForVote(vote) {
  const raw = loadSnapshotArchive()[String(vote || "").trim()];
  if (!Array.isArray(raw) || raw.length === 0) return null;
  return raw.map(item => ({
    vote_key: vote,
    captured_at: item[0] || null,
    status: item[1] ?? null,
    commission: item[2] == null || item[2] === "" ? null : Number(item[2]),
    uptime: item[3] == null || item[3] === "" ? null : Number(item[3]),
    sw_apy: null,
    tr_apy: null,
    pools: null
  }));
}

export function allTimeStatsFromRows(rows) {
  let delinquentCount = 0;
  let commissionChanges = 0;
  let prevCommission = null;
  let hasPrevCommission = false;
  let prevStatus = null;
  let hasPrevStatus = false;
  const commissionChangeEvents = [];
  const statusChangeEvents = [];
  const MAX_EVENTS = 40;

  for (const row of rows) {
    if (row?.status && row.status !== "healthy") delinquentCount++;

    const commission = Number(row?.commission);
    if (Number.isFinite(commission)) {
      if (hasPrevCommission && prevCommission !== commission) {
        commissionChanges++;
        if (commissionChangeEvents.length < MAX_EVENTS) {
          commissionChangeEvents.push({
            from: prevCommission,
            to: commission,
            captured_at: row?.captured_at || null
          });
        }
      }
      prevCommission = commission;
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

  return {
    sample_count: rows.length,
    delinquent_count: delinquentCount,
    commission_changes: commissionChanges,
    commission_change_events: commissionChangeEvents,
    status_change_events: statusChangeEvents
  };
}
