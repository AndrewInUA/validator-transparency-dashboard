import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const RAW_ARCHIVE =
  "https://raw.githubusercontent.com/AndrewInUA/validator-transparency-dashboard/main/data/snapshot-archive.json";
const CACHE_MS = 30 * 60 * 1000;

let cache = null;
let cachedAt = 0;
let loading = null;

function localArchiveFile() {
  const candidates = [];
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    candidates.push(path.join(here, "..", "data", "snapshot-archive.json"));
  } catch {
    // Bundled runtimes may not expose a real file URL.
  }
  candidates.push(path.join(process.cwd(), "data", "snapshot-archive.json"));
  return candidates.find(candidate => {
    try {
      return fs.existsSync(candidate);
    } catch {
      return false;
    }
  }) || null;
}

async function readArchive() {
  const local = localArchiveFile();
  if (local) {
    return JSON.parse(fs.readFileSync(local, "utf8"));
  }

  const response = await fetch(RAW_ARCHIVE);
  if (!response.ok) {
    throw new Error(`Snapshot archive HTTP ${response.status}`);
  }
  return response.json();
}

export async function loadSnapshotArchive() {
  if (cache && Date.now() - cachedAt < CACHE_MS) return cache;
  if (!loading) {
    loading = readArchive()
      .then(data => {
        cache = data && typeof data === "object" ? data : {};
        cachedAt = Date.now();
        return cache;
      })
      .finally(() => {
        loading = null;
      });
  }
  return loading;
}

export async function rowsForVote(vote) {
  const key = String(vote || "").trim();
  const raw = (await loadSnapshotArchive())[key];
  if (!Array.isArray(raw) || raw.length === 0) return null;
  return raw.map(item => ({
    vote_key: key,
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
