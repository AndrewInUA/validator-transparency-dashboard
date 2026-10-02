const RAW_VOTE =
  "https://raw.githubusercontent.com/AndrewInUA/validator-transparency-dashboard/main/data/by-vote/";
const CACHE_MS = 30 * 60 * 1000;

const cache = new Map();

function toRows(vote, raw) {
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

export async function rowsForVote(vote) {
  const key = String(vote || "").trim();
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,48}$/.test(key)) return null;

  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.rows;

  const response = await fetch(`${RAW_VOTE}${key}.json`);
  if (response.status === 404) {
    cache.set(key, { at: Date.now(), rows: null });
    return null;
  }
  if (!response.ok) {
    throw new Error(`Snapshot history HTTP ${response.status}`);
  }
  const rows = toRows(key, await response.json());
  cache.set(key, { at: Date.now(), rows });
  return rows;
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
