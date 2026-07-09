/**
 * Validator Transparency Dashboard – app.js v50
 * Backend-only snapshot model:
 * page open -> /api/track-validator (interest / analytics; optional)
 * CRON -> /api/collect loads every validator from getVoteAccounts, syncs tracked_validators, writes snapshots
 */

const USE_LIVE = true;

/** Example link on the home screen only (no default loaded validator). */
const CREATOR_EXAMPLE_VOTE =
  "3QPGLackJy5LKctYYoPGmA4P8ncyE197jdxr1zP2ho8K";
const CREATOR_EXAMPLE_NAME = "AndrewInUA";

const API_BASE = window.location.hostname.includes("github.io")
  ? "https://validator-transparency-dashboard.vercel.app"
  : "";

const JITO_PROXY = `${API_BASE}/api/jito`;
const SNAPSHOTS_API = `${API_BASE}/api/snapshots`;
const TRACK_VALIDATOR_API = `${API_BASE}/api/track-validator`;
const RPC_PROXY_API = `${API_BASE}/api/rpc`;
const ENV_CHECK_API = `${API_BASE}/api/env-check`;
const SNAPSHOT_WINDOW = 240;

/**
 * Avoid touching the backend on every refresh.
 * One browser will re-touch the same validator at most once per 6 hours.
 */
const TRACK_TOUCH_TTL_MS = 6 * 60 * 60 * 1000;
const EN_DASH = "–";

function getParam(name) {
  const qs = new URLSearchParams(window.location.search);
  if (qs.has(name)) return qs.get(name);

  const hash = window.location.hash.startsWith("#")
    ? window.location.hash.slice(1)
    : window.location.hash;

  const hs = new URLSearchParams(hash);
  if (hs.has(name)) return hs.get(name);

  return null;
}

function computeCurrentValidator() {
  const vote = (getParam("vote") || "").trim();
  const name = (getParam("name") || "").trim();

  return {
    voteKey: vote.length ? vote : "",
    name: name.length ? name : "",
    voteFromUrl: vote.length ? vote : null,
    nameFromUrl: name.length ? name : null
  };
}

const CURRENT = computeCurrentValidator();
const COMPARE_FROM_URL = {
  voteKey: (getParam("vote2") || "").trim(),
  name: (getParam("name2") || "").trim()
};

function shortKey(k) {
  if (!k) return "–";
  return k.length > 12 ? `${k.slice(0, 6)}…${k.slice(-6)}` : k;
}

function fmtPct(v) {
  const n = Number(v);
  return Number.isFinite(n) ? `${n.toFixed(2)}%` : "–%";
}

function fmtSol(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return "–";
  return n >= 1000
    ? n.toLocaleString("en-US", { maximumFractionDigits: 0 })
    : n.toFixed(2);
}

function toFiniteNumber(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function average(nums) {
  const a = nums.filter(x => Number.isFinite(x));
  return a.length ? a.reduce((s, x) => s + x, 0) / a.length : null;
}

function stddev(nums) {
  const a = nums.filter(x => Number.isFinite(x));
  if (a.length < 2) return 0;
  const avg = average(a);
  return Math.sqrt(a.reduce((s, x) => s + (x - avg) ** 2, 0) / a.length);
}

function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}

function epochEarnedCredits(row) {
  if (!Array.isArray(row)) return null;
  const credits = Number(row[1]);
  const prevCredits = Number(row[2]);
  if (Number.isFinite(credits) && Number.isFinite(prevCredits)) {
    return Math.max(0, credits - prevCredits);
  }
  return Number.isFinite(credits) ? Math.max(0, credits) : null;
}

function safeSetText(el, text) {
  if (el) el.textContent = text;
}

/** How much recent epoch history we have; drives copy tone (not user-facing strings). */
function getSampleReliability(n) {
  if (!Number.isFinite(n) || n <= 0) return { level: "none" };
  if (n <= 4) return { level: "very_low" };
  if (n <= 8) return { level: "low" };
  if (n <= 15) return { level: "medium" };
  return { level: "higher" };
}

function simplifyTrendDelta(diff) {
  const n = Math.abs(diff);
  if (!Number.isFinite(n)) return null;
  if (n < 10) return "slightly";
  if (n < 25) return "moderately";
  return "clearly";
}

function buildShareUrl() {
  return buildValidatorUrl(CURRENT.voteKey, CURRENT.nameFromUrl || "");
}

function buildCompareUrl(baseVote, baseName, compareVote, compareName) {
  const base = `${window.location.origin}${window.location.pathname}`;
  const isGHP = window.location.hostname.includes("github.io");
  const params = new URLSearchParams();

  params.set("vote", baseVote);
  if (baseName) params.set("name", baseName);
  if (compareVote) params.set("vote2", compareVote);
  if (compareName) params.set("name2", compareName);

  return isGHP ? `${base}#${params.toString()}` : `${base}?${params.toString()}`;
}

function buildValidatorUrl(voteKey, name) {
  const base = `${window.location.origin}${window.location.pathname}`;
  const isGHP = window.location.hostname.includes("github.io");
  const params = new URLSearchParams();

  params.set("vote", voteKey);
  if (name) params.set("name", name);

  return isGHP ? `${base}#${params.toString()}` : `${base}?${params.toString()}`;
}

function extractVoteAndNameFromInput(rawInput) {
  const raw = String(rawInput || "").trim();
  if (!raw) return { vote: "", name: "" };

  if (isProbablyVoteKey(raw)) return { vote: raw, name: "" };

  try {
    const u = new URL(raw);
    const q = new URLSearchParams(u.search);
    const hash = u.hash.startsWith("#") ? u.hash.slice(1) : u.hash;
    const h = new URLSearchParams(hash);
    return {
      vote: String(q.get("vote") || h.get("vote") || "").trim(),
      name: String(q.get("name") || h.get("name") || "").trim()
    };
  } catch {
    // not a full URL
  }

  const maybeParams = raw.startsWith("#")
    ? raw.slice(1)
    : raw.startsWith("?")
      ? raw.slice(1)
      : raw;
  const p = new URLSearchParams(maybeParams);
  return {
    vote: String(p.get("vote") || "").trim(),
    name: String(p.get("name") || "").trim()
  };
}

function isProbablyVoteKey(value) {
  if (!value || typeof value !== "string") return false;
  const v = value.trim();
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(v);
}

function getTrackStorageKey(voteKey) {
  return `validator-tracked-touch:${voteKey}`;
}

function shouldTouchTracking(voteKey) {
  try {
    const raw = localStorage.getItem(getTrackStorageKey(voteKey));
    if (!raw) return true;

    const prev = Number(raw);
    if (!Number.isFinite(prev)) return true;

    return Date.now() - prev > TRACK_TOUCH_TTL_MS;
  } catch {
    return true;
  }
}

function markTrackingTouched(voteKey) {
  try {
    localStorage.setItem(getTrackStorageKey(voteKey), String(Date.now()));
  } catch {
    // ignore storage failures
  }
}

async function registerValidatorForTracking(voteKey) {
  if (!isProbablyVoteKey(voteKey)) {
    return { ok: false, skipped: true, reason: "invalid_vote_key" };
  }

  if (!shouldTouchTracking(voteKey)) {
    return { ok: true, skipped: true, reason: "recently_touched" };
  }

  try {
    const res = await fetch(TRACK_VALIDATOR_API, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        vote: voteKey
      })
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }

    const json = await res.json();
    markTrackingTouched(voteKey);
    return { ok: true, data: json };
  } catch (err) {
    console.warn("track-validator failed:", err);
    return { ok: false, skipped: false, reason: err?.message || "track_failed" };
  }
}

async function fetchJitoStatus(voteKey) {
  try {
    const res = await fetch(`${JITO_PROXY}?vote=${encodeURIComponent(voteKey)}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const value = typeof json?.jito === "boolean" ? json.jito : null;
    return {
      value,
      source: String(json?.source || "jito_api"),
      status: String(json?.status || "unknown"),
      error: json?.error || null
    };
  } catch {
    return {
      value: null,
      source: "jito_api",
      status: "unavailable",
      error: "fetch_failed"
    };
  }
}

// ── RATINGS ──────────────────────────────────────
async function fetchRatings(voteKey) {
  const res = await fetch(`${API_BASE}/api/ratings?vote=${encodeURIComponent(voteKey)}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/** Public catalog name (e.g. Stakewiz) – not on-chain; optional ?name= still overrides. */
function pickValidatorDisplayName(ratings) {
  if (!ratings) return null;
  if (ratings.display?.name) return String(ratings.display.name).trim();
  const sw = ratings.sources?.stakewiz;
  if (sw && !sw.error && typeof sw.name === "string" && sw.name.trim()) {
    return sw.name.trim();
  }
  return null;
}

function pickTrilliumApy(t) {
  if (!t) return null;
  for (const c of [
    t.average_delegator_total_apy,
    t.delegator_total_apy,
    t.total_overall_apy
  ]) {
    const n = Number(c);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function renderRatings(r) {
  const pools = Array.isArray(r?.pools?.stake_pools) ? r.pools.stake_pools : [];
  const median = r?.derived?.apy_median;
  const trApy = pickTrilliumApy(r?.sources?.trillium);

  safeSetText(document.getElementById("apy-median"), fmtPct(median));
  safeSetText(
    document.getElementById("pools-count"),
    pools.length ? String(pools.length) : "–"
  );
  safeSetText(
    document.getElementById("apy-stakewiz"),
    fmtPct(r?.sources?.stakewiz?.total_apy)
  );
  safeSetText(document.getElementById("apy-trillium"), fmtPct(trApy));
  safeSetText(
    document.getElementById("stake-from-pools"),
    fmtSol(r?.pools?.total_from_stake_pools) + " SOL"
  );
  safeSetText(
    document.getElementById("stake-not-pools"),
    fmtSol(r?.pools?.total_not_from_stake_pools) + " SOL"
  );
  const knownPoolsStake = toFiniteNumber(r?.pools?.total_from_stake_pools);
  const nonPoolStake = toFiniteNumber(r?.pools?.total_not_from_stake_pools);
  const totalStakeContext =
    knownPoolsStake !== null && nonPoolStake !== null
      ? knownPoolsStake + nonPoolStake
      : null;

  safeSetText(document.getElementById("stake-known"), `${fmtSol(knownPoolsStake)} SOL`);
  safeSetText(document.getElementById("stake-other"), `${fmtSol(nonPoolStake)} SOL`);
  safeSetText(document.getElementById("stake-total"), `${fmtSol(totalStakeContext)} SOL`);

  const trOkForPools =
    r?.sources?.trillium &&
    !r?.sources?.trillium?.error &&
    knownPoolsStake !== null &&
    nonPoolStake !== null;
  let stakeSplitNote =
    "Pool vs non-pool split uses Trillium API data. Hover the (i) icons for how to read each number.";
  if (!trOkForPools) {
    stakeSplitNote =
      "Stake breakdown unavailable – Trillium did not return pool data for this validator.";
  } else if (nonPoolStake === 0) {
    stakeSplitNote =
      "Trillium classifies all stake here as pool-sourced (0.00 SOL non-pool). That is their mapping, not an independent wallet audit.";
  } else if (nonPoolStake !== null && nonPoolStake > 0) {
    stakeSplitNote = `Per Trillium data, ${fmtSol(nonPoolStake)} SOL is classified as non-pool stake (often direct native delegations).`;
  }
  safeSetText(document.getElementById("stake-split-note"), stakeSplitNote);

  const poolList = document.getElementById("pools-list");
  if (poolList) {
    poolList.innerHTML = "";
    const top = pools.slice(0, 14);

    if (!top.length) {
      poolList.innerHTML =
        '<span style="font-size:12px;color:var(--text3)">No stake pool data available.</span>';
    } else {
      for (const p of top) {
        const b = document.createElement("span");
        b.className = "pool-badge";
        b.textContent = `${p.name}: ${fmtSol(p.sol)} SOL`;
        poolList.appendChild(b);
      }

      if (pools.length > top.length) {
        const more = document.createElement("span");
        more.className = "pool-badge";
        more.textContent = `+${pools.length - top.length} more`;
        poolList.appendChild(more);
      }
    }
  }

  const sw = r?.sources?.stakewiz;
  const trOk = r?.sources?.trillium && !r?.sources?.trillium?.error && trApy !== null;

  safeSetText(
    document.getElementById("apy-sources-note"),
    "Source status: " +
      (!sw || sw.error ? "Stakewiz unavailable. " : "Stakewiz OK. ") +
      (trOk ? "Trillium OK." : "Trillium unavailable.")
  );
}

// ── LIVE DATA ─────────────────────────────────────
async function fetchLive(voteKey) {
  const EMPTY = {
    commissionHistory: Array(10).fill(0),
    uptimeLast5EpochsPct: 0,
    jito: null,
    jitoStatus: "unavailable",
    jitoError: "rpc_unavailable",
    jitoSource: "jito_api",
    status: "error",
    rpcSource: null,
    votePubkey: null,
    nodePubkey: null,
    epochCreditsLen: 0,
    epochConsistencySeries: [],
    epochHistory: []
  };

  try {
    const res = await fetch(`${RPC_PROXY_API}?vote=${encodeURIComponent(voteKey)}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const json = await res.json();
    const me = json?.data || null;
    if (!me) return { ...EMPTY, status: "not found" };

    const commission = Number(me.commission ?? 0);
    const credits = Array.isArray(me.epochCredits) ? me.epochCredits : [];

    let uptimePct = 0;
    let epochConsistencySeries = [];
    let epochHistory = [];

    try {
      // Each epochCredits row maps to one chart point (normalized vs max delta in window).
      // The LAST row is usually the *current* epoch: credits are still accumulating, so
      // consistency looks artificially low – exclude it from chart + headline uptime.
      const recentRows = credits.slice(-30);
      const deltas = recentRows
        .map(epochEarnedCredits)
        .filter(v => Number.isFinite(v));
      const maxD = deltas.length ? Math.max(...deltas, 1) : 1;
      const finishedRows = recentRows.length > 1 ? recentRows.slice(0, -1) : [];

      epochHistory = finishedRows
        .map(row => {
          const epoch = Number(row[0]);
          const d = epochEarnedCredits(row);
          const consistencyPct = Number.isFinite(d)
            ? Math.round((d / maxD) * 10000) / 100
            : null;
          return { epoch, consistencyPct };
        })
        .filter(h => Number.isFinite(h.epoch) && Number.isFinite(h.consistencyPct));

      epochConsistencySeries = epochHistory.map(h => h.consistencyPct);

      const last5 = epochConsistencySeries.slice(-5);
      uptimePct = last5.length
        ? Math.round((last5.reduce((s, x) => s + x, 0) / last5.length) * 100) /
          100
        : 0;
    } catch (e) {
      console.warn("epoch calc:", e);
    }

    const jitoResult = await fetchJitoStatus(voteKey);
    const status = String(json?.status || "unknown");

    return {
      commissionHistory: Array(10).fill(commission),
      uptimeLast5EpochsPct: uptimePct,
      jito: jitoResult.value,
      jitoStatus: jitoResult.status,
      jitoError: jitoResult.error,
      jitoSource: jitoResult.source,
      status,
      rpcSource: String(json?.rpc_source || ""),
      votePubkey: me.votePubkey,
      nodePubkey: me.nodePubkey || null,
      epochCreditsLen: credits.length,
      epochConsistencySeries,
      epochHistory
    };
  } catch (err) {
    console.warn("RPC proxy failed:", err?.message || err);
    return EMPTY;
  }
}

// ── SNAPSHOTS: READ ONLY ──────────────────────────
function fmtSnapshotDate(iso) {
  if (!iso) return "–";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "–";
  return d.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric"
  });
}

async function loadSnapshotsFromDB(voteKey) {
  try {
    const res = await fetch(
      `${SNAPSHOTS_API}?vote=${encodeURIComponent(voteKey)}&limit=${SNAPSHOT_WINDOW}&include_all_stats=1`
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const json = await res.json();
    const snapshots = Array.isArray(json?.snapshots) ? json.snapshots : [];
    const meta = json?.meta && typeof json.meta === "object" ? json.meta : null;
    return { snapshots, meta };
  } catch (err) {
    console.warn("DB load failed:", err);
    return { snapshots: [], meta: null };
  }
}

async function fetchSystemSignals() {
  try {
    const res = await fetch(ENV_CHECK_API);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    return json?.signals || null;
  } catch {
    return null;
  }
}

function formatSystemSignalsText(signals) {
  if (!signals) return "System signals: unavailable";
  const asWord = v => (v ? "ON" : "OFF");
  return (
    `System signals: Alpha ${asWord(signals.alpha)} · ` +
    `Bravo ${asWord(signals.bravo)} · ` +
    `Charlie ${asWord(signals.charlie)} · ` +
    `Delta ${asWord(signals.delta)}`
  );
}

function renderSystemSignals(signals) {
  const el = document.getElementById("system-signals");
  if (!el) return;
  el.textContent = formatSystemSignalsText(signals);
}

function renderRuntimeSources(live) {
  const el = document.getElementById("runtime-sources");
  if (!el) return;
  const rpc = live?.rpcSource ? "OK" : "Unavailable";
  const rpcSrc = live?.rpcSource || "n/a";
  const jitoState = live?.jito === true ? "ON" : live?.jito === false ? "OFF" : "Unknown";
  const jitoStatus = live?.jitoStatus || "unknown";
  el.textContent = `Runtime sources: RPC ${rpc} (${rpcSrc}) · Jito ${jitoState} (${jitoStatus})`;
}

// ── RECENT PERFORMANCE ────────────────────────────
function computeRecentPerformance({ live, ratings }) {
  const series = (live?.epochConsistencySeries || []).filter(x =>
    Number.isFinite(x)
  );
  const n = series.length;
  const volatility = stddev(series);
  const mid = Math.floor(n / 2);
  const diff = n >= 4 ? average(series.slice(mid)) - average(series.slice(0, mid)) : null;
  const rel = getSampleReliability(n);
  const jito = live?.jito;
  const apyMedian = Number(ratings?.derived?.apy_median);
  const sw = Number(ratings?.sources?.stakewiz?.total_apy);
  const tr = pickTrilliumApy(ratings?.sources?.trillium);

  const out = {
    window: { value: "–", sub: "Waiting for live epoch data from the network." },
    trend: { value: "–", sub: "Need a few epochs of data before we can spot a trend." },
    variability: { value: "–", sub: "Need at least 2 finished epochs before we can measure steadiness." },
    reward: {
      value:
        jito === true
          ? "Jito ON · extra reward potential"
          : jito === false
            ? "Jito OFF · baseline rewards"
            : "Jito signal unknown",
      sub: "–"
    }
  };

  const smallSample = rel.level === "very_low" || rel.level === "low";

  if (n > 0) {
    out.window.value = `${n} epoch${n === 1 ? "" : "s"}`;
    if (rel.level === "very_low") {
      out.window.sub = `Only ${n} ${n === 1 ? "epoch is" : "epochs are"} visible. Treat this as a quick live peek, not full history.`;
    } else if (rel.level === "low") {
      out.window.sub = `${n} recent epochs visible. Good for a quick read, but still a short sample.`;
    } else if (rel.level === "medium") {
      out.window.sub = `${n} recent epochs visible – a reasonable short-term slice.`;
    } else {
      out.window.sub = `${n} recent epochs visible – solid coverage for a short-term view.`;
    }
  }

  if (n >= 4 && Number.isFinite(diff)) {
    if (rel.level === "very_low" || rel.level === "low") {
      out.trend.value = "Not enough data";
      out.trend.sub = `Only ${n} epochs to compare – too few to call a trend confidently.`;
    } else if (diff >= 3) {
      out.trend.value = "Improving";
      out.trend.sub = "Newer epochs look stronger than older ones in this window – good direction.";
    } else if (diff <= -3) {
      out.trend.value = "Getting worse";
      out.trend.sub = "Newer epochs look weaker than older ones – recent yellow flag, worth watching.";
    } else {
      out.trend.value = "Steady";
      out.trend.sub = "Newer and older epochs look about the same – no recent change either way.";
    }
  } else if (n > 0) {
    out.trend.value = "Not enough data";
    out.trend.sub =
      n < 4
        ? "We need at least 4 finished epochs to compare ‘newer’ vs ‘older’."
        : "Not enough signal to describe a trend yet.";
  }

  if (n >= 2 && Number.isFinite(volatility)) {
    if (volatility <= 5) {
      out.variability.value = "Steady";
      out.variability.sub = smallSample
        ? "Epochs look very similar to each other – but the sample is short, so check again later."
        : "Epochs look very similar to each other – predictable behavior.";
    } else if (volatility <= 12) {
      out.variability.value = "Some bumps";
      out.variability.sub = smallSample
        ? "Some ups and downs between epochs; small sample can look noisier than reality."
        : "Some ups and downs between epochs, but no wild swings.";
    } else {
      out.variability.value = "Choppy";
      out.variability.sub =
        "Big jumps between epochs in this window – less predictable short-term behavior." +
        (smallSample ? " Still a short sample – re-check as more epochs come in." : "");
    }
  }

  const rp = [];
  rp.push(
    jito === true
      ? "Jito ON usually means delegators can get a bit more on top of base staking rewards (MEV)."
      : jito === false
        ? "Jito OFF in public data – expect baseline staking rewards without the Jito uplift."
        : "Jito signal is temporarily unavailable, so we can’t confirm this part of rewards right now."
  );
  if (Number.isFinite(apyMedian)) {
    rp.push(
      `Estimated APY ~${apyMedian.toFixed(2)}% (blended from public sources – planning context only, not a guarantee).`
    );
  }
  rp.push(
    Number.isFinite(sw) && Number.isFinite(tr)
      ? Math.abs(sw - tr) <= 1
        ? "APY estimates from Stakewiz and Trillium agree closely – higher confidence."
        : "APY estimates from Stakewiz and Trillium disagree – lower confidence in the exact number."
      : "One of the APY sources is missing right now, so the estimate is less confident."
  );

  out.reward.sub = rp.join(" ");
  return out;
}

function renderRecentPerformance(perf) {
  safeSetText(document.getElementById("perf-window-value"), perf.window.value);
  safeSetText(document.getElementById("perf-window-sub"), perf.window.sub);
  safeSetText(document.getElementById("perf-trend-value"), perf.trend.value);
  safeSetText(document.getElementById("perf-trend-sub"), perf.trend.sub);
  safeSetText(document.getElementById("perf-var-value"), perf.variability.value);
  safeSetText(document.getElementById("perf-var-sub"), perf.variability.sub);
  safeSetText(document.getElementById("perf-reward-value"), perf.reward.value);
  safeSetText(document.getElementById("perf-reward-sub"), perf.reward.sub);
}

function formatSnapshotDate(iso) {
  if (!iso) return "–";
  try {
    return new Date(iso).toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      timeZone: "UTC"
    });
  } catch {
    return "–";
  }
}

function snapshotDayKey(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function trackingPeriodFromMeta(snapshotMeta) {
  const oldest = snapshotMeta?.oldest_captured_at;
  const newest = snapshotMeta?.newest_captured_at;
  if (!oldest || !newest) return null;
  const oMs = new Date(oldest).getTime();
  const nMs = new Date(newest).getTime();
  if (!Number.isFinite(oMs) || !Number.isFinite(nMs) || nMs < oMs) return null;
  const firstDate = formatSnapshotDate(oldest);
  const lastDate = formatSnapshotDate(newest);
  return {
    periodRange: formatDateRange(firstDate, lastDate),
    spanDays: Math.max(1, Math.round((nMs - oMs) / (24 * 60 * 60 * 1000))),
    firstDate,
    lastDate
  };
}

function pluralDays(n) {
  return `${n} day${n === 1 ? "" : "s"}`;
}

function formatDateRange(fromDate, toDate) {
  return `${fromDate} ${EN_DASH} ${toDate}`;
}

function snapshotSpanDays(baseline, latest) {
  const a = new Date(baseline?.captured_at).getTime();
  const b = new Date(latest?.captured_at).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) return 0;
  return (b - a) / (24 * 60 * 60 * 1000);
}

function snapshotStatusLabel(status) {
  const v = String(status || "").toLowerCase();
  if (v === "healthy") return "Healthy";
  if (v === "delinquent") return "Delinquent";
  return status ? String(status) : "Unknown";
}

function collapseSnapshotsByDay(snaps) {
  const byDay = new Map();
  for (const s of snaps) {
    const key = snapshotDayKey(s.captured_at);
    if (!key) continue;
    byDay.set(key, s);
  }
  return [...byDay.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([, row]) => row);
}

function buildTrackingPeriodEvents(dailySnaps) {
  const events = [];
  for (let i = 1; i < dailySnaps.length; i++) {
    const prev = dailySnaps[i - 1];
    const cur = dailySnaps[i];
    const date = formatSnapshotDate(cur.captured_at);

    const cPrev = Number(prev.commission);
    const cCur = Number(cur.commission);
    if (Number.isFinite(cPrev) && Number.isFinite(cCur) && cPrev !== cCur) {
      events.push({
        tone: cCur > cPrev ? "warn" : "ok",
        label: "Commission",
        text: `${cPrev}% ${EN_DASH} ${cCur}% (recorded ${date})`,
        sortKey: cur.captured_at,
        isChange: true
      });
    }

    if (
      String(prev.status || "").toLowerCase() !== String(cur.status || "").toLowerCase()
    ) {
      events.push({
        tone: String(cur.status || "").toLowerCase() === "delinquent" ? "warn" : "ok",
        label: "Status",
        text: `${snapshotStatusLabel(prev.status)} ${EN_DASH} ${snapshotStatusLabel(cur.status)} (recorded ${date})`,
        sortKey: cur.captured_at,
        isChange: true
      });
    }

    const uPrev = Number(prev.uptime);
    const uCur = Number(cur.uptime);
    if (
      Number.isFinite(uPrev) &&
      Number.isFinite(uCur) &&
      uPrev > 1 &&
      uCur > 1 &&
      Math.abs(uCur - uPrev) >= 5
    ) {
      events.push({
        tone: uCur < uPrev - 5 ? "warn" : "neutral",
        label: "Voting consistency",
        text: `${uPrev.toFixed(1)}% ${EN_DASH} ${uCur.toFixed(1)}% (recorded ${date})`,
        sortKey: cur.captured_at,
        isChange: true
      });
    }
  }

  return events.sort((a, b) => String(b.sortKey).localeCompare(String(a.sortKey)));
}

function computeEpochHistoryWindow(live) {
  const history = (live?.epochHistory || []).filter(
    h => Number.isFinite(h.epoch) && Number.isFinite(h.consistencyPct)
  );
  if (!history.length) return null;

  const values = history.map(h => h.consistencyPct);
  const avg = average(values);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const first = history[0];
  const last = history[history.length - 1];

  const items = [
    {
      tone: min >= 95 ? "ok" : min >= 85 ? "neutral" : "warn",
      label: "Epoch summary",
      text: `${history.length} finished epochs in RPC window (epoch ${first.epoch} ${EN_DASH} ${last.epoch}): ~${avg.toFixed(1)}% avg, ${min.toFixed(1)}%${EN_DASH}${max.toFixed(1)}% range. In-progress epoch excluded.`
    },
    ...history
      .slice()
      .reverse()
      .map(h => ({
        tone: h.consistencyPct >= 95 ? "ok" : h.consistencyPct >= 85 ? "neutral" : "warn",
        label: `Epoch ${h.epoch}`,
        text: `~${h.consistencyPct.toFixed(1)}% voting consistency`
      }))
  ];

  return {
    title: "Epoch voting (live RPC)",
    intro:
      "Solana epochs are voting periods (~2 days each), numbered on-chain. This list is live network data – separate from daily snapshots above.",
    items
  };
}

function computeWhatChanged({ snaps, live, stability, snapshotMeta }) {
  const dailySnaps = collapseSnapshotsByDay(snaps);
  const n = dailySnaps.length;
  const epochWindow = computeEpochHistoryWindow(live);

  if (n === 0) {
    return {
      ready: false,
      headline: "No stored snapshots yet for this validator.",
      sub: "Daily snapshots are collected for all mainnet validators. A change log appears once history builds.",
      historyWindow: null,
      patternWindow: null,
      epochWindow
    };
  }

  if (n === 1) {
    return {
      ready: false,
      headline: "Tracking just started for this validator.",
      sub: `First stored snapshot: ${formatSnapshotDate(dailySnaps[0].captured_at)} (UTC). Check back after more daily runs for a change log.`,
      historyWindow: null,
      patternWindow: null,
      epochWindow
    };
  }

  const fullPeriod = trackingPeriodFromMeta(snapshotMeta);
  const windowFirstDate = formatSnapshotDate(dailySnaps[0].captured_at);
  const windowLastDate = formatSnapshotDate(dailySnaps[n - 1].captured_at);
  const windowRange = formatDateRange(windowFirstDate, windowLastDate);
  const periodRange = fullPeriod?.periodRange ?? windowRange;
  const spanDays =
    fullPeriod?.spanDays ??
    Math.max(1, Math.round(snapshotSpanDays(dailySnaps[0], dailySnaps[n - 1])));
  const totalAll = Number.isFinite(Number(snapshotMeta?.total_count))
    ? Number(snapshotMeta.total_count)
    : snaps.length;
  const windowStartsAtOldest =
    snapshotMeta?.oldest_captured_at &&
    snapshotDayKey(dailySnaps[0].captured_at) ===
      snapshotDayKey(snapshotMeta.oldest_captured_at);
  const hasPartialWindow = !windowStartsAtOldest || dailySnaps.length < totalAll;
  const allTime = snapshotMeta?.all_time;
  const events = buildTrackingPeriodEvents(dailySnaps);

  const commissionChanges = Number.isFinite(Number(allTime?.commission_changes))
    ? Number(allTime.commission_changes)
    : events.filter(e => e.label === "Commission").length;
  const delinquentDays = Number.isFinite(Number(allTime?.delinquent_count))
    ? Number(allTime.delinquent_count)
    : snaps.filter(s => String(s.status || "").toLowerCase() === "delinquent").length;

  const latest = dailySnaps[n - 1];
  const latestCom = Number(latest.commission);
  const lastDate = fullPeriod?.lastDate ?? windowLastDate;

  const windowSpanDays = Math.max(
    1,
    Math.round(snapshotSpanDays(dailySnaps[0], dailySnaps[n - 1]))
  );

  let headline =
    events.length === 0
      ? `Steady over ${pluralDays(spanDays)} of stored snapshots (${periodRange}).`
      : `${events.length} recorded change${events.length === 1 ? "" : "s"} over ${pluralDays(spanDays)} (${periodRange}).`;

  let sub = `${totalAll.toLocaleString("en-US")} snapshots in storage (${periodRange}).`;
  const eventCommissionCount = events.filter(e => e.label === "Commission").length;
  const needsWindowNote =
    hasPartialWindow &&
    (events.length > 0 || commissionChanges > eventCommissionCount);
  if (needsWindowNote) {
    sub += ` Day-by-day list below covers the most recent ${pluralDays(windowSpanDays)} loaded in this view (${windowRange}); pattern rows use full history.`;
  } else if (!hasPartialWindow) {
    sub += ` Checked day by day across full stored history.`;
  } else {
    sub += ` Commission, delinquency, and stability use full stored history.`;
  }
  sub += ` Not staking advice.`;

  let historyItems;
  if (events.length > 0) {
    historyItems = events;
  } else if (commissionChanges > 0 || delinquentDays > 0) {
    const parts = [];
    if (commissionChanges > 0) {
      parts.push(
        `${commissionChanges} commission change${commissionChanges === 1 ? "" : "s"}`
      );
    }
    if (delinquentDays > 0) {
      parts.push(
        `${delinquentDays} delinquent snapshot day${delinquentDays === 1 ? "" : "s"}`
      );
    }
    historyItems = [
      {
        tone: commissionChanges > 0 ? "neutral" : "warn",
        label: "Change log",
        text: `${parts.join("; ")} on record across ${periodRange}.`
      }
    ];
  } else {
    historyItems = [
      {
        tone: "ok",
        label: "Change log",
        text: `No commission or status changes across ${periodRange}.`
      }
    ];
  }

  const patternItems = [];
  if (Number.isFinite(latestCom)) {
    patternItems.push({
      tone:
        commissionChanges > 0 ? "neutral" : commissionLevelTone(latestCom),
      label: "Commission pattern",
      text:
        commissionChanges === 0
          ? latestCom >= 100
            ? `Unchanged at 100% – validator keeps all rewards; stakers earn nothing`
            : latestCom >= 50
              ? `Unchanged at ${latestCom}% across the full tracking period (high fee for stakers)`
              : `Unchanged at ${latestCom}% across the full tracking period`
          : `${commissionChanges} commission change${commissionChanges === 1 ? "" : "s"} recorded ${EN_DASH} currently ${latestCom}%`
    });
  }

  patternItems.push({
    tone: delinquentDays === 0 ? "ok" : "warn",
    label: "Delinquency in snapshots",
    text:
      delinquentDays === 0
        ? `No delinquent days in ${totalAll.toLocaleString("en-US")} stored snapshots`
        : `${delinquentDays} delinquent snapshot day${delinquentDays === 1 ? "" : "s"} out of ${totalAll.toLocaleString("en-US")}`
  });

  const stabilityScore = Number.isFinite(stability?.allTimeScore)
    ? stability.allTimeScore
    : stability?.score;
  if (Number.isFinite(stabilityScore)) {
    patternItems.push({
      tone: stabilityScore >= 85 ? "ok" : stabilityScore >= 50 ? "neutral" : "warn",
      label: "Stability score",
      text: `${stabilityScore}/100 from full snapshot history`
    });
  }

  if (
    live?.status &&
    latest?.status &&
    String(live.status).toLowerCase() !== String(latest.status).toLowerCase()
  ) {
    const liveStatus = normalizeStatusForCompare(live?.status);
    patternItems.push({
      tone: String(live.status).toLowerCase() === "delinquent" ? "warn" : "neutral",
      label: "Live status now",
      text: `${liveStatus.label || "Unknown"} on RPC now ${EN_DASH} latest stored snapshot is ${snapshotStatusLabel(latest.status)} (${lastDate})`
    });
  }

  return {
    ready: true,
    headline,
    sub,
    historyWindow: {
      title: events.length ? "Recorded changes (newest first)" : "Recorded changes",
      items: historyItems
    },
    patternWindow: {
      title: "Pattern over tracking period",
      items: patternItems
    },
    epochWindow
  };
}

function renderWhatChangedList(el, items) {
  if (!el) return;
  if (!items?.length) {
    el.innerHTML = "";
    return;
  }
  el.innerHTML = items
    .map(
      item =>
        `<li class="what-changed-item" data-tone="${escapeHtmlDirectory(item.tone || "neutral")}">` +
        `<span class="what-changed-label">${escapeHtmlDirectory(item.label)}</span>` +
        `<span class="what-changed-text">${escapeHtmlDirectory(item.text)}</span>` +
        `</li>`
    )
    .join("");
}

function renderWhatChangedWindow(wrapEl, listEl, windowData) {
  if (!wrapEl || !listEl) return;
  if (!windowData?.items?.length) {
    wrapEl.hidden = true;
    listEl.innerHTML = "";
    const introEl = wrapEl.querySelector(".what-changed-section-intro");
    if (introEl) introEl.textContent = "";
    return;
  }
  wrapEl.hidden = false;
  const titleEl = wrapEl.querySelector(".what-changed-section-title");
  if (titleEl) {
    if (windowData.spanLabel) {
      titleEl.textContent = `${windowData.title} (${windowData.spanLabel})`;
    } else {
      titleEl.textContent = windowData.title;
    }
  }
  const introEl = wrapEl.querySelector(".what-changed-section-intro");
  if (introEl) {
    if (windowData.intro) {
      introEl.hidden = false;
      introEl.textContent = windowData.intro;
    } else {
      introEl.hidden = true;
      introEl.textContent = "";
    }
  }
  renderWhatChangedList(listEl, windowData.items);
}

function renderWhatChanged(summary) {
  const card = document.getElementById("what-changed-card");
  const headlineEl = document.getElementById("what-changed-headline");
  const subEl = document.getElementById("what-changed-sub");
  const historyWrap = document.getElementById("what-changed-history-wrap");
  const patternWrap = document.getElementById("what-changed-pattern-wrap");
  const historyList = document.getElementById("what-changed-history-list");
  const patternList = document.getElementById("what-changed-pattern-list");
  const epochWrap = document.getElementById("what-changed-epoch-wrap");
  const epochList = document.getElementById("what-changed-epoch-list");

  if (!card) return;

  card.style.display = "block";
  safeSetText(headlineEl, summary.headline || "–");
  safeSetText(subEl, summary.sub || "");

  renderWhatChangedWindow(historyWrap, historyList, summary.historyWindow);
  renderWhatChangedWindow(patternWrap, patternList, summary.patternWindow);
  renderWhatChangedWindow(epochWrap, epochList, summary.epochWindow);

  if (!summary.ready) {
    if (historyWrap) historyWrap.hidden = true;
    if (patternWrap) patternWrap.hidden = true;
    if (historyList) historyList.innerHTML = "";
    if (patternList) patternList.innerHTML = "";
    if (epochWrap) epochWrap.hidden = true;
    if (epochList) epochList.innerHTML = "";
  }
}

let changeHistoryExportCtx = null;

function buildChangeHistorySummaryText(ctx) {
  if (!ctx) return "";
  const lines = [
    `Change history – ${ctx.name}`,
    `Vote account: ${ctx.voteKey}`,
    "",
    ctx.whatChanged?.headline || "",
    ctx.whatChanged?.sub || ""
  ];

  const historyItems = ctx.whatChanged?.historyWindow?.items || [];
  const patternItems = ctx.whatChanged?.patternWindow?.items || [];

  if (historyItems.length) {
    lines.push("", "Recorded changes:");
    for (const item of historyItems) {
      lines.push(`• ${item.label}: ${item.text}`);
    }
  }

  if (patternItems.length) {
    lines.push("", "Pattern over tracking period:");
    for (const item of patternItems) {
      lines.push(`• ${item.label}: ${item.text}`);
    }
  }

  const epochItems = ctx.whatChanged?.epochWindow?.items || [];
  if (epochItems.length) {
    lines.push("", "Epoch voting (live RPC):");
    if (ctx.whatChanged?.epochWindow?.intro) {
      lines.push(ctx.whatChanged.epochWindow.intro);
    }
    for (const item of epochItems) {
      lines.push(`• ${item.label}: ${item.text}`);
    }
  }

  lines.push(
    "",
    `Profile: ${document.getElementById("share-url")?.value?.trim() || ctx.shareUrl || ""}`,
    "",
    "Source: Validator Transparency Dashboard. Not staking advice."
  );

  return lines.join("\n");
}

function setChangeHistoryExportContext(ctx) {
  changeHistoryExportCtx = ctx;
  const wrap = document.getElementById("what-changed-export-wrap");
  if (wrap) wrap.hidden = !ctx?.voteKey;
}

async function downloadChangeHistoryCsv(voteKey, btn) {
  const defaultLabel = "Download CSV";
  if (btn) {
    btn.disabled = true;
    btn.textContent = "Preparing…";
  }

  try {
    const res = await fetch(
      `${SNAPSHOTS_API}?vote=${encodeURIComponent(voteKey)}&format=csv`
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const blob = await res.blob();
    const dispo = res.headers.get("Content-Disposition") || "";
    const match = /filename="([^"]+)"/i.exec(dispo);
    const filename =
      match?.[1] || `validator-${voteKey.slice(0, 8)}-daily-snapshots.csv`;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    if (btn) btn.textContent = "Downloaded";
  } catch (err) {
    console.warn("CSV export failed:", err);
    if (btn) btn.textContent = "Failed";
  } finally {
    if (btn) {
      setTimeout(() => {
        btn.disabled = false;
        btn.textContent = defaultLabel;
      }, 1500);
    }
  }
}

function wireChangeHistoryExports() {
  const copyBtn = document.getElementById("what-changed-copy-btn");
  const csvBtn = document.getElementById("what-changed-csv-btn");
  const copyDefault = "Copy summary";

  if (copyBtn && !copyBtn.dataset.wired) {
    copyBtn.dataset.wired = "1";
    copyBtn.addEventListener("click", async () => {
      if (!changeHistoryExportCtx) return;
      try {
        await navigator.clipboard.writeText(
          buildChangeHistorySummaryText(changeHistoryExportCtx)
        );
        copyBtn.textContent = "Copied!";
      } catch {
        copyBtn.textContent = "Error";
      }
      setTimeout(() => {
        copyBtn.textContent = copyDefault;
      }, 1500);
    });
  }

  if (csvBtn && !csvBtn.dataset.wired) {
    csvBtn.dataset.wired = "1";
    csvBtn.addEventListener("click", () => {
      if (!changeHistoryExportCtx?.voteKey) return;
      downloadChangeHistoryCsv(changeHistoryExportCtx.voteKey, csvBtn);
    });
  }
}

// ── STABILITY ─────────────────────────────────────
function commissionLevelTone(commissionPct) {
  if (!Number.isFinite(commissionPct)) return "neutral";
  if (commissionPct >= 50) return "warn";
  if (commissionPct <= 5) return "ok";
  return "neutral";
}

function computeStability({ live, ratings, poolsCount, snaps, snapshotMeta }) {
  const n = snaps.length;
  const totalAll =
    snapshotMeta && Number.isFinite(Number(snapshotMeta.total_count))
      ? Number(snapshotMeta.total_count)
      : null;
  const nowStatus = live?.status || "–";
  const nowUptime = Number(live?.uptimeLast5EpochsPct || 0);
  const sw = Number(ratings?.sources?.stakewiz?.total_apy);
  const tr = pickTrilliumApy(ratings?.sources?.trillium);
  const apyDiff =
    Number.isFinite(sw) && Number.isFinite(tr) ? Math.abs(sw - tr) : null;

  let delinquentCount = 0;
  let commissionChanges = 0;

  for (let i = 0; i < n; i++) {
    if (snaps[i]?.status && snaps[i].status !== "healthy") delinquentCount++;
    if (
      i > 0 &&
      Number.isFinite(snaps[i].commission) &&
      Number.isFinite(snaps[i - 1].commission) &&
      snaps[i].commission !== snaps[i - 1].commission
    ) {
      commissionChanges++;
    }
  }

  function scoreFromRecentSignals(sampleCount, delinquent, commissionShift, latestCommission) {
    // Recent score: hybrid signal (history window + current/live context).
    let s = 100;
    if (nowStatus === "delinquent") s -= 40;
    s -= (sampleCount ? (delinquent / sampleCount) * 40 : 0);
    s -= clamp(commissionShift * 5, 0, 20);
    if (Number.isFinite(latestCommission)) {
      if (latestCommission >= 100) s -= 40;
      else if (latestCommission >= 50) s -= 30;
      else if (latestCommission > 10) s -= clamp((latestCommission - 10) * 1.5, 0, 15);
    }
    if (Number.isFinite(nowUptime) && nowUptime < 95) {
      s -= clamp((95 - nowUptime) * 1.5, 0, 20);
    }
    if (apyDiff !== null && apyDiff > 1) {
      s -= clamp((apyDiff - 1) * 5, 0, 15);
    }
    if (!Number.isFinite(poolsCount) || poolsCount <= 0) s -= 10;
    return clamp(Math.round(s), 0, 100);
  }

  function scoreFromAllTimeSnapshots(sampleCount, delinquent, commissionShift, latestCommission) {
    // All-time score: snapshot-history only (no live/API side inputs).
    let s = 100;
    s -= (sampleCount ? (delinquent / sampleCount) * 40 : 0);
    s -= clamp(commissionShift * 5, 0, 20);
    if (Number.isFinite(latestCommission)) {
      if (latestCommission >= 100) s -= 40;
      else if (latestCommission >= 50) s -= 30;
      else if (latestCommission > 10) s -= clamp((latestCommission - 10) * 1.5, 0, 15);
    }
    return clamp(Math.round(s), 0, 100);
  }

  const latestSnapshotCom = n ? Number(snaps[n - 1].commission) : NaN;
  const liveComHistory = live?.commissionHistory || [];
  const liveCom = liveComHistory.length ? Number(liveComHistory[liveComHistory.length - 1]) : NaN;
  const latestCommission = Number.isFinite(liveCom) ? liveCom : latestSnapshotCom;

  let score = scoreFromRecentSignals(n, delinquentCount, commissionChanges, latestCommission);

  let label =
    score >= 85 ? "Strong" :
    score >= 70 ? "Good" :
    score >= 50 ? "Watch" :
    "Risk";

  // Keep score math stable, but mark early-history results as provisional.
  let isProvisional = false;
  if (n === 0) {
    label = "Insufficient data";
    isProvisional = true;
  } else if (n < 4) {
    label = "Early data";
    isProvisional = true;
  } else if (n < 8) {
    if (label === "Strong") label = "Provisional";
    isProvisional = true;
  }

  let trackingText = "No history yet";
  let allTimeMetaLine = "";

  if (totalAll !== null && totalAll === 0) {
    allTimeMetaLine = "All-time: no snapshots yet.";
  } else if (
    totalAll !== null &&
    totalAll > 0 &&
    snapshotMeta?.oldest_captured_at &&
    snapshotMeta?.newest_captured_at
  ) {
    const o = fmtSnapshotDate(snapshotMeta.oldest_captured_at);
    const ne = fmtSnapshotDate(snapshotMeta.newest_captured_at);
    allTimeMetaLine = `All-time: ${totalAll.toLocaleString("en-US")} snapshots (${o} ${EN_DASH} ${ne}).`;
  } else if (totalAll !== null && totalAll > 0) {
    allTimeMetaLine = `All-time: ${totalAll.toLocaleString("en-US")} snapshots.`;
  }

  if (n >= 2) {
    const t0 = new Date(snaps[0].captured_at || Date.now()).getTime();
    const t1 = new Date(snaps[n - 1].captured_at || Date.now()).getTime();
    const days = Math.max(0, (t1 - t0) / (24 * 3600 * 1000));

    trackingText =
      days >= 1
        ? `${Math.round(days)}d`
        : `${Math.max(1, Math.round(days * 24))}h`;
  } else if (n === 1) {
    trackingText = "1 snapshot (early)";
  }

  const allTimeSample = Number(snapshotMeta?.all_time?.sample_count);
  const allTimeDelinquent = Number(snapshotMeta?.all_time?.delinquent_count);
  const allTimeCommissionChanges = Number(snapshotMeta?.all_time?.commission_changes);
  const hasAllTimeSignals =
    Number.isFinite(allTimeSample) &&
    allTimeSample > 0 &&
    Number.isFinite(allTimeDelinquent) &&
    Number.isFinite(allTimeCommissionChanges);
  const signalScope = hasAllTimeSignals ? "all-time history" : "loaded snapshots";
  const signalSample = hasAllTimeSignals ? allTimeSample : n;
  const signalDelinquent = hasAllTimeSignals ? allTimeDelinquent : delinquentCount;
  const signalCommissionChanges = hasAllTimeSignals
    ? allTimeCommissionChanges
    : commissionChanges;

  const pills = [];

  pills.push({
    ok: signalSample >= 2 ? signalDelinquent === 0 : false,
    text:
      signalSample >= 2
        ? signalDelinquent === 0
          ? `No delinquency in ${signalScope}`
          : `Delinquency in ${signalScope} (${signalDelinquent}/${signalSample})`
        : "Delinquency signal waiting for more snapshots",
    tip: "Snapshot-only signal from stored history."
  });

  pills.push({
    ok:
      signalSample >= 2 &&
      signalCommissionChanges === 0 &&
      (!Number.isFinite(latestCommission) || latestCommission < 50),
    text:
      signalSample >= 2
        ? signalCommissionChanges === 0
          ? Number.isFinite(latestCommission) && latestCommission >= 100
            ? `Commission at 100% in ${signalScope} (stakers earn nothing)`
            : Number.isFinite(latestCommission) && latestCommission >= 50
              ? `Commission at ${latestCommission}% in ${signalScope} (unchanged; high fee)`
              : `Commission stable in ${signalScope}`
          : `Commission changes in ${signalScope}: ${signalCommissionChanges}`
        : "Commission-change signal waiting for more snapshots",
    tip:
      Number.isFinite(latestCommission) && latestCommission >= 50
        ? latestCommission >= 100
          ? "100% commission – stakers earn nothing even when the rate is unchanged."
          : "High commission level – unchanged still means most rewards go to the validator, not stakers."
        : "Snapshot-only signal from stored commission history."
  });

  pills.push({
    ok: Number.isFinite(totalAll) && totalAll >= 24,
    text:
      Number.isFinite(totalAll) && totalAll > 0
        ? `Snapshot depth stored: ${totalAll.toLocaleString("en-US")}`
        : "Snapshot depth is still building",
    tip: "Snapshot-only confidence signal: more stored history usually means more stable scoring."
  });

  let allTimeScore = null;
  let allTimeLabel = "Not enough data";
  if (hasAllTimeSignals) {
    allTimeScore = scoreFromAllTimeSnapshots(
      allTimeSample,
      allTimeDelinquent,
      allTimeCommissionChanges,
      latestCommission
    );
    allTimeLabel =
      allTimeScore >= 85 ? "Strong" :
      allTimeScore >= 70 ? "Good" :
      allTimeScore >= 50 ? "Watch" :
      "Risk";
  }

  return {
    score,
    label,
    isProvisional,
    allTimeScore,
    allTimeLabel,
    trackingText,
    allTimeMetaLine,
    pills
  };
}

function renderStability(st) {
  const scoreEl = document.getElementById("stability-score");
  const labelEl = document.getElementById("stability-label");
  const hasAllTimePrimary = Number.isFinite(st.allTimeScore);
  const primaryScore = hasAllTimePrimary ? st.allTimeScore : st.score;
  const primaryLabel = hasAllTimePrimary ? st.allTimeLabel : st.label;
  safeSetText(scoreEl, primaryScore);
  safeSetText(labelEl, primaryLabel);
  if (scoreEl) {
    scoreEl.className = `ring-num ${!hasAllTimePrimary && st.isProvisional ? "ring-uncertain" : ""}`.trim();
  }
  if (labelEl) {
    labelEl.className = `ring-label ${!hasAllTimePrimary && st.isProvisional ? "ring-uncertain" : ""}`.trim();
  }
  safeSetText(
    document.getElementById("stability-tracking"),
    hasAllTimePrimary ? "all stored snapshot history only" : st.trackingText
  );
  const allTimeEl = document.getElementById("stability-alltime-meta");
  if (allTimeEl) {
    const line = st.allTimeMetaLine || "";
    allTimeEl.textContent = line;
    allTimeEl.style.display = line ? "block" : "none";
  }
  const pillsEl = document.getElementById("stability-pills");
  if (pillsEl) {
    pillsEl.innerHTML = "";
    for (const p of st.pills) {
      const span = document.createElement("span");
      span.className = `pill ${p.ok ? "pill-ok" : "pill-warn"}`;
      span.textContent = p.text;
      if (p.tip) span.title = p.tip;
      pillsEl.appendChild(span);
    }
  }

  if (window.animateRing) window.animateRing(primaryScore);
}

/** One-row KPI strip under the reading guide: full delegator context before scroll. */
function renderDelegatorSnapshotStrip({
  live,
  stability,
  latestCom,
  uptimeNum,
  poolsCount,
  apyMedian
}) {
  const stEl = document.getElementById("snapshot-stability");
  if (stEl) {
    if (stability) {
      const hasAllTime = Number.isFinite(stability.allTimeScore);
      const sc = hasAllTime ? stability.allTimeScore : stability.score;
      if (Number.isFinite(sc)) {
        stEl.textContent = `${Math.round(sc)}/100`;
        stEl.className =
          "delegator-snapshot-value " +
          (sc >= 85 ? "val-ok" : sc >= 50 ? "val-muted" : "val-warn");
      } else {
        stEl.textContent = "–";
        stEl.className = "delegator-snapshot-value val-muted";
      }
    } else {
      stEl.textContent = "–";
      stEl.className = "delegator-snapshot-value val-muted";
    }
  }

  const comEl = document.getElementById("snapshot-commission");
  if (comEl) {
    if (Number.isFinite(latestCom)) {
      comEl.textContent = `${latestCom.toFixed(0)}%`;
      comEl.className =
        "delegator-snapshot-value " +
        (latestCom >= 50 ? "val-warn" : latestCom <= 5 ? "val-ok" : "val-muted");
      comEl.title =
        latestCom >= 100
          ? "100% commission – validator keeps all rewards; stakers earn nothing"
          : latestCom >= 50
            ? "High commission – most rewards go to the validator, not stakers"
            : "Validator fee on staking rewards – lower is better for stakers";
    } else {
      comEl.textContent = "–";
      comEl.className = "delegator-snapshot-value val-muted";
    }
  }

  const statusVal = live?.status || "";
  const statusEl = document.getElementById("snapshot-status");
  if (statusEl) {
    const label = statusVal
      ? statusVal.charAt(0).toUpperCase() + statusVal.slice(1)
      : "–";
    statusEl.textContent = label;
    statusEl.className =
      "delegator-snapshot-value " +
      (statusVal === "healthy" ? "val-ok" : statusVal ? "val-warn" : "val-muted");
  }

  const votEl = document.getElementById("snapshot-voting");
  if (votEl) {
    if (Number.isFinite(uptimeNum)) {
      votEl.textContent = `${uptimeNum.toFixed(1)}%`;
      votEl.className =
        "delegator-snapshot-value " +
        (uptimeNum >= 99 ? "val-ok" : uptimeNum >= 90 ? "val-muted" : "val-warn");
    } else {
      votEl.textContent = "–";
      votEl.className = "delegator-snapshot-value val-muted";
    }
  }

  const j = live?.jito;
  const jEl = document.getElementById("snapshot-jito");
  if (jEl) {
    if (j === true) {
      jEl.textContent = "ON";
      jEl.className = "delegator-snapshot-value val-upside";
    } else if (j === false) {
      jEl.textContent = "OFF";
      jEl.className = "delegator-snapshot-value val-muted";
    } else {
      jEl.textContent = "–";
      jEl.className = "delegator-snapshot-value val-muted";
    }
  }

  const apyEl = document.getElementById("snapshot-apy");
  if (apyEl) {
    apyEl.textContent = fmtPct(apyMedian);
    apyEl.className = "delegator-snapshot-value val-muted";
  }

  const poolsEl = document.getElementById("snapshot-pools");
  if (poolsEl) {
    if (Number.isFinite(poolsCount)) {
      poolsEl.textContent = String(poolsCount);
      poolsEl.className =
        "delegator-snapshot-value " + (poolsCount > 0 ? "val-ok" : "val-muted");
    } else {
      poolsEl.textContent = "–";
      poolsEl.className = "delegator-snapshot-value val-muted";
    }
  }
}

function pushUnique(list, text) {
  if (!text) return;
  if (!list.includes(text)) list.push(text);
}

/** `{ pill, tip }` – short on-card copy; explanation in tooltip (`title`). */
function pushUniqueInsight(list, entry) {
  if (!entry || typeof entry.pill !== "string" || !entry.pill.trim()) return;
  if (!list.some(x => x.pill === entry.pill)) list.push(entry);
}

function computeDelegatorAssessment({ live, ratings, poolsCount, snaps, stability }) {
  const positives = [];
  const cautions = [];
  let commissionCriticalRisk = false;

  const commissionHistory = Array.isArray(live?.commissionHistory)
    ? live.commissionHistory
    : [];
  const latestCommission = commissionHistory.length
    ? Number(commissionHistory[commissionHistory.length - 1])
    : null;
  const uptime = Number(live?.uptimeLast5EpochsPct);
  const status = String(live?.status || "unknown");
  const jito = live?.jito;
  const apyMedian = Number(ratings?.derived?.apy_median);
  const snapCount = Array.isArray(snaps) ? snaps.length : 0;
  const stabilityScore = Number(stability?.score);

  let signalPoints = 0;

  if (Number.isFinite(latestCommission)) {
    if (latestCommission === 0) {
      signalPoints += 2;
      pushUniqueInsight(positives, {
        pill: "0% commission",
        tip: "Validator commission is 0%; delegators keep the full staking-reward slice on this commission line. Liquid-staking programs or wallets may still charge their own fees."
      });
    } else if (latestCommission <= 5) {
      signalPoints += 1;
      pushUniqueInsight(positives, {
        pill: `${latestCommission.toFixed(0)}% commission`,
        tip: "Low validator commission improves net staking yield versus higher-fee operators; always compare totals with pool or wallet fees."
      });
    } else if (latestCommission >= 100) {
      signalPoints -= 6;
      commissionCriticalRisk = true;
      pushUniqueInsight(cautions, {
        pill: "100% commission",
        tip: "Stop sign for stakers: the validator keeps 100% of staking rewards – delegators routed through ordinary staking normally earn nothing. Do not stake here unless you fully intend that."
      });
    } else if (latestCommission >= 50) {
      signalPoints -= 3;
      pushUniqueInsight(cautions, {
        pill: `${latestCommission.toFixed(0)}% commission`,
        tip: "Very high commission removes most staking rewards – treat this as a severe yield drag versus network norms."
      });
    } else if (latestCommission > 10) {
      signalPoints -= 2;
      pushUniqueInsight(cautions, {
        pill: `${latestCommission.toFixed(0)}% commission`,
        tip: "High commission materially trims net staking yield; compare alternatives before locking stake."
      });
    } else {
      signalPoints -= 1;
      pushUniqueInsight(cautions, {
        pill: `${latestCommission.toFixed(0)}% commission`,
        tip: "Commission above baseline still reduces rewards relative to 0%-fee validators; quantify impact before delegating."
      });
    }
  }

  if (status === "healthy") {
    signalPoints += 2;
    pushUniqueInsight(positives, {
      pill: "Healthy status",
      tip: "RPC vote-account status is Healthy right now – that is a live snapshot, not proof of eternal uptime."
    });
  } else if (status === "delinquent") {
    signalPoints -= 3;
    pushUniqueInsight(cautions, {
      pill: "Delinquent status",
      tip: "Network currently marks this vote account delinquent – missed consensus participation in the measured window."
    });
  } else if (status !== "unknown") {
    signalPoints -= 1;
    pushUniqueInsight(cautions, {
      pill: `Status: ${status}`,
      tip: "Non-healthy/non-delinquent response from RPC aggregation – verify upstream health before staking."
    });
  }

  if (Number.isFinite(uptime)) {
    if (uptime >= 95) {
      signalPoints += 2;
      pushUniqueInsight(positives, {
        pill: `Recent voting ${uptime.toFixed(1)}%`,
        tip: `Recent voting consistency is strong (${uptime.toFixed(1)}%), averaged across the last finished epochs queried from RPC.`
      });
    } else if (uptime >= 90) {
      signalPoints += 1;
      pushUniqueInsight(positives, {
        pill: `Recent voting ${uptime.toFixed(1)}%`,
        tip: "Recent epochs show acceptable – but not flawless – vote credit usage; corroborate with Trust card + stability history."
      });
    } else {
      signalPoints -= 2;
      pushUniqueInsight(cautions, {
        pill: `Recent voting ${uptime.toFixed(1)}%`,
        tip: `Recent voting materially below typical ~99%+ norms (${uptime.toFixed(1)}%) – stress-test before delegating.`
      });
    }
  }

  if (Number.isFinite(stabilityScore)) {
    if (stabilityScore >= 85) {
      signalPoints += 2;
      pushUniqueInsight(positives, {
        pill: `Stability ${Math.round(stabilityScore)}/100`,
        tip: `Stability score is strong (${stabilityScore}/100) inside this dashboard's archived snapshots (delinquency + commission churn signals).`
      });
    } else if (stabilityScore >= 70) {
      signalPoints += 1;
      pushUniqueInsight(positives, {
        pill: `Stability ${Math.round(stabilityScore)}/100`,
        tip: `Moderate-but-healthy stability score (${stabilityScore}/100) – compare depth of snapshots before treating as airtight.`
      });
    } else if (stabilityScore < 50) {
      signalPoints -= 2;
      pushUniqueInsight(cautions, {
        pill: `Stability ${Math.round(stabilityScore)}/100`,
        tip: `Stability reads low (${stabilityScore}/100) – historical churn or downtime signal in stored snapshots warrants manual review.`
      });
    } else {
      signalPoints -= 1;
      pushUniqueInsight(cautions, {
        pill: `Stability ${Math.round(stabilityScore)}/100`,
        tip: `Mixed stability read (${stabilityScore}/100); pair with Stability card narrative before deciding.`
      });
    }
  }

  if (snapCount >= 24) {
    signalPoints += 1;
    pushUniqueInsight(positives, {
      pill: `${snapCount} snapshots on file`,
      tip: `${snapCount} recent snapshots underpin this rollup – confidence improves as more archival days accumulate.`
    });
  } else if (snapCount < 8) {
    signalPoints -= 1;
    pushUniqueInsight(cautions, {
      pill: `${snapCount} snapshots on file`,
      tip: "Snapshot history still thin inside this dashboard; interpret checklist outputs as early reads, not longitudinally airtight."
    });
  }

  if (jito === true) {
    signalPoints += 1;
    pushUniqueInsight(positives, {
      pill: "Jito on",
      tip: "Jito flag is ON in live telemetry – potential for supplemental MEV / bundle-mediated rewards versus vanilla consensus yield (not guaranteed)."
    });
  } else if (jito === false) {
    pushUniqueInsight(cautions, {
      pill: "Jito off",
      tip: "Public Jito feed reports OFF – staking yield likely tracks baseline staking economics without incremental Jito-related upside."
    });
  }

  if (Number.isFinite(apyMedian)) {
    pushUniqueInsight(positives, {
      pill: `Blended APY ~${apyMedian.toFixed(2)}%`,
      tip: `Blended APY estimate (~${apyMedian.toFixed(2)}%) from third-party endpoints (Stakewiz + Trillium); illustrative, never a contractual quote.`
    });
  } else {
    pushUniqueInsight(cautions, {
      pill: "No APY figure",
      tip: "Median APY rollup unavailable – defer yield comparisons until public feeds recover."
    });
  }

  if (Number.isFinite(poolsCount) && poolsCount > 0) {
    signalPoints += 1;
    pushUniqueInsight(positives, {
      pill: `${poolsCount} pools staking`,
      tip: `${poolsCount} recognized stake pools expose liquidity to this vote account – a soft trust signal but not endorsement of future performance.`
    });
  } else {
    signalPoints -= 1;
    pushUniqueInsight(cautions, {
      pill: "Pools not detected",
      tip: "No labeled stake-pool exposures detected via current catalog feed – solo stake or unrecognized pools remain possible."
    });
  }

  const verdict = commissionCriticalRisk
    ? { label: "Caution", className: "warn" }
    : signalPoints >= 6
      ? { label: "Attractive", className: "ok" }
      : signalPoints >= 2
        ? { label: "Balanced", className: "ok" }
        : { label: "Caution", className: "warn" };

  const tone = commissionCriticalRisk
    ? "caution"
    : verdict.label === "Attractive"
      ? "attractive"
      : verdict.label === "Balanced"
        ? "balanced"
        : "caution";

  const confidence =
    snapCount >= 48
      ? "High"
      : snapCount >= 12
        ? "Medium"
        : "Low";

  let summaryDisplay = "";
  let summaryTooltip = "";

  if (commissionCriticalRisk) {
    summaryDisplay =
      "100% commission – stop sign for stakers. Ordinary delegation earns nothing.";
    summaryTooltip =
      "The validator keeps every staking reward. Unless you explicitly accept zero yield for delegators, do not stake here.";
  } else if (verdict.label === "Attractive") {
    summaryDisplay =
      "Most displayed signals currently support this validator for delegator consideration.";
    summaryTooltip =
      "Short-list posture from on-page telemetry (commission tier, RPC health, recent epochs, archival stability reads, staking-pool linkage, blended APYs). Automated synthesis – still cross-check verdict card + primary sources.";
  } else if (verdict.label === "Balanced") {
    summaryDisplay =
      "Signals read mixed-positive – pair attractors with cautions below before sizing stake.";
    summaryTooltip =
      "Balanced heuristics imply nothing catastrophic yet nothing pristine; scan Watch bullets for asymmetric risks.";
  } else {
    summaryDisplay =
      "Caution flagged – audit Trust + Stability narratives before staking here.";
    summaryTooltip =
      "Multiple guardrails breached in this rollup; investigate commission, uptime, archival stability depth, liquidity signals, APY stubs until comfortable.";
  }

  return {
    verdict,
    tone,
    summary: summaryDisplay,
    summaryTooltip,
    summaryTone: commissionCriticalRisk || verdict.label === "Caution" ? "warn" : "neutral",
    positives: positives.slice(0, 4),
    cautions: cautions.slice(0, 4),
    confidence
  };
}

/** Minimal copy for Signal breakdown header (i) tulip */
function signalBreakdownTooltipFor() {
  return "Positives on the left; things to watch on the right.";
}

function renderDelegatorAssessment(assessment) {
  const card = document.querySelector(".delegator-assessment-card");
  if (card && assessment.tone) {
    card.dataset.delegatorTone = assessment.tone;
  }

  const summaryEl = document.getElementById("delegator-summary");
  if (summaryEl) {
    summaryEl.hidden = false;
    summaryEl.style.display = "";
    summaryEl.removeAttribute("title");
    summaryEl.classList.toggle("delegator-summary-warn", assessment.summaryTone === "warn");
    summaryEl.textContent = assessment.summary || "";
  }

  const confEl = document.getElementById("delegator-confidence");
  if (confEl) {
    confEl.removeAttribute("title");
    confEl.className = "last-updated";
    confEl.textContent = `How sure we are: ${assessment.confidence}`;
  }

  const breakdownInfoEl = document.getElementById("delegator-assessment-info");
  if (breakdownInfoEl) {
    breakdownInfoEl.dataset.tip = signalBreakdownTooltipFor();
    breakdownInfoEl.setAttribute("aria-label", "What this checklist means");
  }

  const verdictEl = document.getElementById("delegator-verdict");
  if (verdictEl) {
    verdictEl.textContent = assessment.verdict.label;
    verdictEl.removeAttribute("title");
    verdictEl.className = `status-big ${assessment.verdict.className}`;
  }

  const appendInsightRows = (container, rows, polarity) => {
    if (!container) return;
    container.innerHTML = "";
    container.className = "pills-col";
    let list =
      rows && rows.length
        ? rows
        : polarity === "good"
          ? [
              {
                pill: "No positives synthesized",
                tip: "Insufficient positive flags met threshold – could be telemetry gaps or genuinely weak signals."
              }
            ]
          : [];
    const isClearWatch = polarity === "watch" && !(rows && rows.length);
    if (isClearWatch) {
      list = [
        {
          pill: "No major warning signals right now.",
          tip: "No caution rows fired in this rollup. Still skim Trust + Stability + charts – they carry raw context this checklist compresses."
        }
      ];
    }
    for (const raw of list) {
      const entry =
        raw && typeof raw === "object" && "pill" in raw
          ? raw
          : { pill: String(raw || "–"), tip: "" };
      const pill = document.createElement("span");
      const warnStyle = polarity === "watch" && rows && rows.length;
      pill.className = warnStyle ? "pill pill-warn has-tip-spot" : "pill pill-ok has-tip-spot";
      pill.textContent = entry.pill;
      if (entry.tip) pill.title = entry.tip;
      container.appendChild(pill);
    }
  };

  appendInsightRows(document.getElementById("delegator-good"), assessment.positives, "good");
  appendInsightRows(document.getElementById("delegator-watch"), assessment.cautions, "watch");
}

function renderCommissionStakerHint(latestCom) {
  const el = document.getElementById("commission-staker-hint");
  if (!el) return;

  if (Number.isFinite(latestCom) && latestCom >= 100) {
    el.innerHTML =
      "<strong>Stop sign for stakers:</strong> 100% commission means the validator keeps <em>every</em> staking reward – delegators normally earn <strong>nothing</strong>. Do not stake here unless you fully intend that.";
    el.classList.add("commission-hint-critical");
    return;
  }

  el.classList.remove("commission-hint-critical");
  if (Number.isFinite(latestCom) && latestCom >= 50) {
    el.innerHTML =
      `<strong>High fee warning:</strong> ${latestCom.toFixed(0)}% commission means most staking rewards go to the validator, not stakers. Compare carefully before delegating.`;
    return;
  }

  el.innerHTML =
    "Lower is usually better for your net yield. 0% means the validator takes no fee here (pool/program fees may still apply). <strong>100% is a stop sign for stakers</strong> – the validator keeps all rewards; delegators normally earn nothing.";
}

function renderCommissionCriticalAlert(commissionPct) {
  const el = document.getElementById("commission-critical-alert");
  if (!el) return;

  if (Number.isFinite(commissionPct) && commissionPct >= 100) {
    el.style.display = "block";
    el.innerHTML =
      "<strong>Stop – 100% commission:</strong> this validator keeps <em>all</em> staking rewards. " +
      "For ordinary stakers, net yield is effectively <strong>zero</strong>. " +
      "This is one of the worst outcomes for delegators – do not stake here unless you explicitly intend that setup.";
    return;
  }

  if (Number.isFinite(commissionPct) && commissionPct >= 50) {
    el.style.display = "block";
    el.innerHTML =
      `<strong>High commission warning:</strong> current validator commission is ${commissionPct.toFixed(0)}%. ` +
      "Most rewards go to the validator, not stakers – this can wipe out delegator yield.";
    return;
  }

  el.style.display = "none";
  el.textContent = "";
}

function renderUpsideSignals({ live, latestCom, uptimeNum, poolsCount, apyMedian }) {
  const wrap = document.getElementById("upside-signals-wrap");
  const row = document.getElementById("upside-signals");
  if (!wrap || !row) return;

  const chips = [];
  if (Number.isFinite(latestCom) && latestCom <= 5) chips.push(`Low fee (${latestCom.toFixed(0)}%)`);
  if (Number.isFinite(uptimeNum) && uptimeNum >= 95) chips.push(`Strong consistency (${uptimeNum.toFixed(1)}%)`);
  if (Number.isFinite(poolsCount) && poolsCount > 0) chips.push(`${poolsCount} pools delegating`);
  if (Number.isFinite(apyMedian)) chips.push(`APY estimate available (~${apyMedian.toFixed(2)}%)`);

  row.innerHTML = "";
  const shown = chips.slice(0, 3);
  for (const text of shown) {
    const chip = document.createElement("span");
    chip.className = "badge upside";
    chip.textContent = text;
    row.appendChild(chip);
  }

  wrap.style.display = shown.length ? "block" : "none";
}

function normalizeStatusForCompare(status) {
  const raw = String(status || "").toLowerCase();
  if (raw === "healthy") return { rank: 2, label: "Healthy" };
  if (raw === "delinquent") return { rank: 0, label: "Delinquent" };
  if (!raw || raw === "unknown") return { rank: 1, label: "Unknown" };
  return { rank: 1, label: raw.charAt(0).toUpperCase() + raw.slice(1) };
}

let __networkStatsPromise = null;
async function loadNetworkStats() {
  if (__networkStatsPromise) return __networkStatsPromise;
  __networkStatsPromise = fetch(`${API_BASE}/api/network-stats`, { cache: "no-store" })
    .then(async r => {
      if (!r.ok) return null;
      const j = await r.json().catch(() => null);
      return j && j.ok ? j : null;
    })
    .catch(() => null);
  return __networkStatsPromise;
}

function percentileOfValue(value, statBucket) {
  if (!Number.isFinite(value) || !statBucket) return null;
  const refs = [
    { p: 0, v: statBucket.min },
    { p: 10, v: statBucket.p10 },
    { p: 25, v: statBucket.p25 },
    { p: 50, v: statBucket.median },
    { p: 75, v: statBucket.p75 },
    { p: 90, v: statBucket.p90 },
    { p: 100, v: statBucket.max }
  ].filter(r => Number.isFinite(r.v));
  if (refs.length < 2) return null;
  if (value <= refs[0].v) return refs[0].p;
  if (value >= refs[refs.length - 1].v) return refs[refs.length - 1].p;
  for (let i = 1; i < refs.length; i += 1) {
    const a = refs[i - 1];
    const b = refs[i];
    if (value <= b.v) {
      const range = b.v - a.v;
      const w = range > 0 ? (value - a.v) / range : 0;
      return a.p + (b.p - a.p) * w;
    }
  }
  return 50;
}

function formatVsNetworkText({ value, stats, mode, unit = "", decimals = 1 }) {
  if (!Number.isFinite(value) || !stats || !Number.isFinite(stats.median)) {
    return "";
  }
  const med = stats.median;
  const fmt = n => `${Number(n).toFixed(decimals)}${unit}`;
  const pct = percentileOfValue(value, stats);
  const close = Math.abs(value - med) / Math.max(med || 1, 1) < 0.05;
  let comparison;
  if (close) {
    comparison = "around the network median";
  } else if (mode === "lower") {
    comparison =
      value < med
        ? "below network median (better for delegators)"
        : "above network median";
  } else {
    comparison = value > med ? "above network median" : "below network median";
  }
  let percentileText = "";
  if (Number.isFinite(pct)) {
    const beats =
      mode === "lower" ? Math.max(0, Math.min(100, 100 - pct)) : pct;
    percentileText = ` – better than ${Math.round(beats)}% of validators`;
  }
  return `Network median ${fmt(med)} · ${comparison}${percentileText}`;
}

function setVsNetworkSubtext(targetEl, text) {
  if (!targetEl) return;
  let sub = targetEl.parentElement?.querySelector(":scope > .vs-network");
  if (!text) {
    if (sub) sub.remove();
    return;
  }
  if (!sub) {
    sub = document.createElement("div");
    sub.className = "vs-network";
    targetEl.insertAdjacentElement("afterend", sub);
  }
  sub.textContent = text;
}

function snapshotHistoryDays(snapshotMeta) {
  const oldest = snapshotMeta?.oldest_captured_at;
  if (!oldest) return null;
  const t = new Date(oldest).getTime();
  if (!Number.isFinite(t)) return null;
  const days = (Date.now() - t) / (24 * 3600 * 1000);
  return days > 0 ? days : 0;
}

function computeVerdict({
  stability,
  snapshotMeta,
  liveStatus,
  recentVotingPct,
  commission,
  apy,
  poolsCount,
  networkStats
}) {
  const status = String(liveStatus || "").toLowerCase();
  const isDelinquentNow = status === "delinquent";
  const stabilityScore = Number.isFinite(stability?.allTimeScore)
    ? stability.allTimeScore
    : Number.isFinite(stability?.score)
      ? stability.score
      : null;
  const historyDays = snapshotHistoryDays(snapshotMeta);
  const totalSnapshots = Number(snapshotMeta?.all_time?.sample_count);
  const allTimeDelinquent = Number(snapshotMeta?.all_time?.delinquent_count);
  const allTimeCommissionChanges = Number(
    snapshotMeta?.all_time?.commission_changes
  );

  const commissionMedian = Number.isFinite(networkStats?.stats?.commission?.median)
    ? networkStats.stats.commission.median
    : null;
  const apyMedian = Number.isFinite(networkStats?.stats?.apy?.median)
    ? networkStats.stats.apy.median
    : null;

  const reasons = [];
  let tier = "watch";

  if (isDelinquentNow) {
    tier = "caution";
    reasons.push("currently delinquent on the network");
  } else if (Number.isFinite(commission) && commission >= 100) {
    tier = "caution";
    reasons.push("commission is 100% – stakers earn nothing; validator keeps all rewards");
  } else if (Number.isFinite(commission) && commission >= 80) {
    tier = "caution";
    reasons.push(`commission is ${commission.toFixed(0)}% – most rewards go to the validator, not stakers`);
  } else if (
    Number.isFinite(recentVotingPct) &&
    recentVotingPct < 90 &&
    recentVotingPct > 0
  ) {
    tier = "caution";
    reasons.push(
      `recent voting % is ${recentVotingPct.toFixed(1)}% – well below the ~99% norm`
    );
  } else if (
    Number.isFinite(stabilityScore) &&
    stabilityScore < 60 &&
    Number.isFinite(historyDays) &&
    historyDays >= 14
  ) {
    tier = "caution";
    reasons.push(`stability score is ${stabilityScore}/100 over recorded history`);
  } else if (
    !Number.isFinite(stabilityScore) ||
    (Number.isFinite(historyDays) && historyDays < 14) ||
    (Number.isFinite(totalSnapshots) && totalSnapshots < 14)
  ) {
    tier = "wait";
    if (Number.isFinite(historyDays)) {
      reasons.push(
        `only ~${Math.max(1, Math.round(historyDays))} day${Math.round(historyDays) === 1 ? "" : "s"} of stored history so far`
      );
    } else {
      reasons.push("not enough stored snapshot history yet");
    }
  } else {
    const positives = [];
    const negatives = [];

    if (stabilityScore >= 90) positives.push("strong stability score");
    else if (stabilityScore >= 70) positives.push("solid stability score");
    else negatives.push(`stability score ${stabilityScore}/100`);

    if (Number.isFinite(historyDays) && historyDays >= 60) {
      positives.push(`${Math.round(historyDays)} days of recorded history`);
    }

    if (Number.isFinite(commission)) {
      if (commission <= 5) {
        positives.push(`low validator commission (${commission.toFixed(0)}%)`);
      } else if (commission >= 10) {
        negatives.push(`higher validator commission (${commission.toFixed(0)}%)`);
      }
    }

    if (Number.isFinite(apy) && Number.isFinite(apyMedian)) {
      if (apy >= apyMedian) positives.push(`APY at or above network median`);
      else if (apyMedian - apy > 0.3) negatives.push(`APY below network median`);
    }

    if (
      Number.isFinite(recentVotingPct) &&
      recentVotingPct >= 99 &&
      Number.isFinite(allTimeDelinquent) &&
      allTimeDelinquent === 0
    ) {
      positives.push("no delinquency events on record");
    }

    if (Number.isFinite(allTimeCommissionChanges) && allTimeCommissionChanges === 0) {
      positives.push("no fee changes on record");
    }

    const meetsRecommended =
      Number.isFinite(stabilityScore) &&
      stabilityScore >= 90 &&
      Number.isFinite(historyDays) &&
      historyDays >= 60 &&
      (!Number.isFinite(recentVotingPct) || recentVotingPct >= 98) &&
      (!Number.isFinite(commission) ||
        !Number.isFinite(commissionMedian) ||
        commission <= commissionMedian + 1) &&
      negatives.length === 0;

    const meetsPromising =
      !meetsRecommended &&
      negatives.length === 0 &&
      Number.isFinite(historyDays) &&
      historyDays >= 14 &&
      historyDays < 60 &&
      Number.isFinite(stabilityScore) &&
      stabilityScore >= 85 &&
      (!Number.isFinite(recentVotingPct) || recentVotingPct >= 95) &&
      (!Number.isFinite(commission) || commission < 80);

    if (meetsRecommended) {
      tier = "recommended";
      reasons.push(positives.slice(0, 3).join(", ") || "consistent recorded behavior");
    } else if (meetsPromising) {
      tier = "promising";
      const d = Math.round(historyDays);
      reasons.push(
        `${positives.slice(0, 3).join(", ") || "healthy signals on record"}. ` +
          `Early read with ~${d} day${d === 1 ? "" : "s"} of stored history so far; confidence naturally improves as more snapshots accumulate. Rewards on-chain are unaffected.`
      );
    } else {
      tier = "watch";
      const blurb = [];
      if (positives.length) blurb.push(`what looks good: ${positives.slice(0, 2).join(", ")}`);
      if (negatives.length) {
        blurb.push(`what to double-check: ${negatives.slice(0, 2).join(", ")}`);
      } else {
        blurb.push("a few numbers are only average compared with the rest of the network");
      }
      reasons.push(blurb.join("; "));
    }
  }

  const meta = {
    recommended: {
      label: "Strong signals, longer track record here",
      blurbPrefix: "Tracked metrics read strong –"
    },
    promising: {
      label: "Steady signals so far",
      blurbPrefix: "No major flags in tracked metrics –"
    },
    watch: {
      label: "Mixed signals – compare with others",
      blurbPrefix: "Neutral read –"
    },
    wait: {
      label: "Early read on our charts",
      blurbPrefix: "History is still building in this dashboard –"
    },
    caution: {
      label: "Risk flags – read carefully",
      blurbPrefix: "Notable concerns in tracked metrics –"
    }
  };
  const m = meta[tier];
  const rationale = `${m.blurbPrefix} ${reasons.join("; ")}.`;

  return {
    tier,
    label: m.label,
    rationale,
    historyDays: Number.isFinite(historyDays) ? historyDays : null,
    stabilityScore,
    commissionMedian,
    apyMedian
  };
}

function renderVerdictBadge(verdict) {
  const root = document.getElementById("verdict-card");
  const tierEl = document.getElementById("verdict-tier");
  const labelEl = document.getElementById("verdict-label");
  const rationaleEl = document.getElementById("verdict-rationale");
  const metaEl = document.getElementById("verdict-meta");
  if (!root || !labelEl || !rationaleEl) return;

  const cls =
    verdict.tier === "recommended"
      ? "verdict-recommended"
      : verdict.tier === "promising"
        ? "verdict-promising"
        : verdict.tier === "caution"
          ? "verdict-caution"
          : verdict.tier === "wait"
            ? "verdict-wait"
            : "verdict-watch";

  const chipByTier = {
    recommended: "Lime · long steady track here",
    promising: "Mint · steady signals so far",
    watch: "Yellow · compare with others",
    wait: "Gray · new in our charts",
    caution: "Orange · risk flags present"
  };

  root.className = `card verdict-card ${cls}`;
  if (tierEl) {
    tierEl.textContent = chipByTier[verdict.tier] || verdict.label;
  }
  labelEl.textContent = verdict.label;
  rationaleEl.textContent = verdict.rationale;

  if (metaEl) {
    const bits = [];
    if (Number.isFinite(verdict.historyDays)) {
      bits.push(`~${Math.round(verdict.historyDays)} days of data tracked here`);
    }
    if (Number.isFinite(verdict.stabilityScore)) {
      bits.push(`Stability score ${Math.round(verdict.stabilityScore)}/100`);
    }
    metaEl.textContent = bits.join(" · ");
  }

  root.style.display = "";
}

function formatScoreText(score, label) {
  return Number.isFinite(score) ? `${score}/100 (${label || "–"})` : "–";
}

function displayCompareName(voteKey) {
  return shortKey(voteKey);
}

function compareBetter(a, b, mode) {
  const an = Number(a);
  const bn = Number(b);
  if (!Number.isFinite(an) || !Number.isFinite(bn)) return "na";
  const eps = mode === "status" ? 0 : 0.05;
  if (Math.abs(an - bn) <= eps) return "tie";
  if (mode === "lower") return an < bn ? "left" : "right";
  return an > bn ? "left" : "right";
}

function renderComparePanel({ baseName, compareName, baseMetrics, compareMetrics }) {
  const panel = document.getElementById("compare-panel");
  const rowsEl = document.getElementById("compare-rows");
  const summaryEl = document.getElementById("compare-summary");
  const rulesEl = document.getElementById("compare-rules");
  const whyEl = document.getElementById("compare-why");
  const nameAEl = document.getElementById("compare-name-a");
  const nameBEl = document.getElementById("compare-name-b");
  if (!panel || !rowsEl || !summaryEl) return;

  const safeBaseName = baseName || "Current";
  const safeCompareName = compareName || "Compared";

  if (nameAEl) nameAEl.textContent = `Validator A (${safeBaseName})`;
  if (nameBEl) nameBEl.textContent = `Validator B (${safeCompareName})`;

  const rows = [
    {
      metric: "Stability score",
      currentText: formatScoreText(baseMetrics.stabilityScore, baseMetrics.stabilityLabel),
      compareText: formatScoreText(compareMetrics.stabilityScore, compareMetrics.stabilityLabel),
      currentValue: baseMetrics.stabilityScore,
      compareValue: compareMetrics.stabilityScore,
      mode: "higher",
      why: "fewer past delinquency events and fewer commission changes in stored snapshot history",
      whyNote: "Newer validators can score lower simply because they have less history yet, not because they behaved worse."
    },
    {
      metric: "Commission",
      currentText: Number.isFinite(baseMetrics.commission) ? `${baseMetrics.commission.toFixed(0)}%` : "–",
      compareText: Number.isFinite(compareMetrics.commission) ? `${compareMetrics.commission.toFixed(0)}%` : "–",
      currentValue: baseMetrics.commission,
      compareValue: compareMetrics.commission,
      mode: "lower",
      why: "lower commission means the validator keeps a smaller cut of your rewards"
    },
    {
      metric: "Recent voting consistency",
      currentText: Number.isFinite(baseMetrics.uptime) ? `${baseMetrics.uptime.toFixed(1)}%` : "–",
      compareText: Number.isFinite(compareMetrics.uptime) ? `${compareMetrics.uptime.toFixed(1)}%` : "–",
      currentValue: baseMetrics.uptime,
      compareValue: compareMetrics.uptime,
      mode: "higher",
      why: "higher recent voting % means more votes landed on time across the last finished epochs"
    },
    {
      metric: "Live status",
      currentText: baseMetrics.statusLabel,
      compareText: compareMetrics.statusLabel,
      currentValue: baseMetrics.statusRank,
      compareValue: compareMetrics.statusRank,
      mode: "status",
      why: "Healthy = currently voting normally; Delinquent = currently missing votes"
    },
    {
      metric: "APY (median)",
      currentText: Number.isFinite(baseMetrics.apyMedian) ? `${baseMetrics.apyMedian.toFixed(2)}%` : "–",
      compareText: Number.isFinite(compareMetrics.apyMedian) ? `${compareMetrics.apyMedian.toFixed(2)}%` : "–",
      currentValue: baseMetrics.apyMedian,
      compareValue: compareMetrics.apyMedian,
      mode: "higher",
      why: "higher estimated yearly yield from public APIs (Stakewiz / Trillium)",
      whyNote: "APY is an estimate, not a guarantee – small differences (<0.2%) are often noise."
    },
    {
      metric: "Pools delegating",
      currentText: Number.isFinite(baseMetrics.poolsCount) ? String(baseMetrics.poolsCount) : "–",
      compareText: Number.isFinite(compareMetrics.poolsCount) ? String(compareMetrics.poolsCount) : "–",
      currentValue: baseMetrics.poolsCount,
      compareValue: compareMetrics.poolsCount,
      mode: "higher",
      why: "more known staking pools (Marinade, Jito, etc.) already trust this validator with stake",
      whyNote: "Pools take time to onboard new validators, so newer operators often start at 0 here."
    }
  ];

  rowsEl.innerHTML = "";
  const wins = { left: 0, right: 0, tie: 0 };
  const reasonsLeft = [];
  const reasonsRight = [];
  const tiedMetrics = [];
  const naMetrics = [];

  for (const r of rows) {
    const better = compareBetter(r.currentValue, r.compareValue, r.mode);
    if (better === "left") {
      wins.left += 1;
      reasonsLeft.push(r);
    } else if (better === "right") {
      wins.right += 1;
      reasonsRight.push(r);
    } else if (better === "tie") {
      wins.tie += 1;
      tiedMetrics.push(r.metric);
    } else {
      naMetrics.push(r.metric);
    }

    const row = document.createElement("div");
    row.className = "compare-row";

    const metric = document.createElement("div");
    metric.className = "compare-row-metric";
    metric.textContent = r.metric;
    row.appendChild(metric);

    const current = document.createElement("div");
    current.textContent = r.currentText;
    row.appendChild(current);

    const compared = document.createElement("div");
    compared.textContent = r.compareText;
    row.appendChild(compared);

    const betterEl = document.createElement("div");
    betterEl.className = `compare-row-better ${
      better === "tie" || better === "na" ? "tie" : "good"
    }`.trim();
    betterEl.textContent =
      better === "left"
        ? "Validator A"
        : better === "right"
          ? "Validator B"
          : better === "tie"
            ? "About the same"
            : "Not enough data";
    row.appendChild(betterEl);

    rowsEl.appendChild(row);
  }

  if (rulesEl) {
    rulesEl.textContent =
      "A = currently opened validator. B = entered validator. Higher is better for Stability, Voting consistency, APY, and Pools delegating. Lower is better for Commission. For live status: Healthy is best.";
  }

  let verdictLabel;
  if (wins.left === wins.right) {
    verdictLabel = `Overall: A (${safeBaseName}) and B (${safeCompareName}) look about the same – they each win ${wins.left} of the ${rows.length} metrics below.`;
  } else if (wins.left > wins.right) {
    verdictLabel = `Overall for a delegator: Validator A (${safeBaseName}) looks stronger here – it wins ${wins.left} of the ${rows.length} metrics below, B wins ${wins.right}.`;
  } else {
    verdictLabel = `Overall for a delegator: Validator B (${safeCompareName}) looks stronger here – it wins ${wins.right} of the ${rows.length} metrics below, A wins ${wins.left}.`;
  }
  summaryEl.textContent = verdictLabel;

  if (whyEl) {
    const esc = escapeHtmlDirectory;
    const renderReasonList = (winnerLabel, reasons) => {
      if (!reasons.length) return "";
      const items = reasons
        .map(r => {
          const note = r.whyNote
            ? ` <span style="color:var(--text3)">– ${esc(r.whyNote)}</span>`
            : "";
          return `<li><strong>${esc(r.metric)}:</strong> ${esc(r.why || "")}.${note}</li>`;
        })
        .join("");
      return (
        `<div class="compare-why-title">Why ${esc(winnerLabel)} wins these metrics</div>` +
        `<ul>${items}</ul>`
      );
    };

    let html = "";
    if (wins.left > wins.right && reasonsLeft.length) {
      html += renderReasonList(`Validator A (${safeBaseName})`, reasonsLeft);
      if (reasonsRight.length) {
        html +=
          `<div class="compare-why-tied">Validator B (${esc(safeCompareName)}) wins ` +
          reasonsRight.map(r => `<strong>${esc(r.metric)}</strong>`).join(", ") +
          ` – weigh those if they matter to you.</div>`;
      }
    } else if (wins.right > wins.left && reasonsRight.length) {
      html += renderReasonList(`Validator B (${safeCompareName})`, reasonsRight);
      if (reasonsLeft.length) {
        html +=
          `<div class="compare-why-tied">Validator A (${esc(safeBaseName)}) wins ` +
          reasonsLeft.map(r => `<strong>${esc(r.metric)}</strong>`).join(", ") +
          ` – weigh those if they matter to you.</div>`;
      }
    } else if (wins.left === wins.right && (reasonsLeft.length || reasonsRight.length)) {
      if (reasonsLeft.length) {
        html += renderReasonList(`Validator A (${safeBaseName})`, reasonsLeft);
      }
      if (reasonsRight.length) {
        html += renderReasonList(`Validator B (${safeCompareName})`, reasonsRight);
      }
    } else {
      html +=
        `<div class="compare-why-title">Why neither side clearly wins</div>` +
        `<div>All visible metrics are too close to call or have no data yet – treat them as roughly equal.</div>`;
    }

    if (tiedMetrics.length) {
      html +=
        `<div class="compare-why-tied">Tied on: ${tiedMetrics.map(esc).join(", ")} – both look similar here.</div>`;
    }
    if (naMetrics.length) {
      html +=
        `<div class="compare-why-tied">Not enough data for: ${naMetrics.map(esc).join(", ")}.</div>`;
    }

    html +=
      `<div class="compare-why-excluded">` +
      `<strong>What this verdict does NOT include:</strong> total stake size, validator age, geographic location, hardware setup, or decentralization impact. ` +
      `Those don't directly change your rewards as a delegator, so they're left out of this quick verdict on purpose. ` +
      `If a newer validator looks weaker on <em>Stability score</em> or <em>Pools delegating</em>, it may simply be young – those metrics improve with time.` +
      `</div>`;

    whyEl.innerHTML = html;
    whyEl.hidden = false;
  }

  panel.style.display = "block";
}

async function loadComparisonMetrics(voteKey) {
  const [live, ratings, snapshotPack] = await Promise.all([
    fetchLive(voteKey),
    fetchRatings(voteKey).catch(() => null),
    loadSnapshotsFromDB(voteKey)
  ]);

  const poolsCount = Array.isArray(ratings?.pools?.stake_pools)
    ? ratings.pools.stake_pools.length
    : null;
  const stability = computeStability({
    live,
    ratings,
    poolsCount,
    snaps: snapshotPack.snapshots,
    snapshotMeta: snapshotPack.meta
  });
  const primaryStability = Number.isFinite(stability.allTimeScore)
    ? stability.allTimeScore
    : stability.score;
  const primaryLabel = Number.isFinite(stability.allTimeScore)
    ? stability.allTimeLabel
    : stability.label;
  const status = normalizeStatusForCompare(live?.status);

  const commissionHistory = Array.isArray(live?.commissionHistory)
    ? live.commissionHistory
    : [];
  const latestCommission = commissionHistory.length
    ? Number(commissionHistory[commissionHistory.length - 1])
    : null;

  const autoName = pickValidatorDisplayName(ratings);

  return {
    stabilityScore: Number.isFinite(primaryStability) ? primaryStability : null,
    stabilityLabel: primaryLabel || "–",
    commission: Number.isFinite(latestCommission) ? latestCommission : null,
    uptime: Number.isFinite(Number(live?.uptimeLast5EpochsPct))
      ? Number(live.uptimeLast5EpochsPct)
      : null,
    statusRank: status.rank,
    statusLabel: status.label,
    apyMedian: Number.isFinite(Number(ratings?.derived?.apy_median))
      ? Number(ratings.derived.apy_median)
      : null,
    poolsCount: Number.isFinite(poolsCount) ? poolsCount : null,
    displayLabel: autoName || shortKey(voteKey)
  };
}

async function initLandingPage() {
  const inp = document.getElementById("landing-vote-input");
  const btn = document.getElementById("landing-open-btn");
  const ex = document.getElementById("landing-example-link");
  const fb = document.getElementById("landing-feedback");

  if (ex) {
    ex.href = buildValidatorUrl(CREATOR_EXAMPLE_VOTE, CREATOR_EXAMPLE_NAME);
  }

  const go = () => {
    if (fb) fb.textContent = "";
    const parsed = extractVoteAndNameFromInput(inp?.value || "");
    if (!isProbablyVoteKey(parsed.vote)) {
      if (fb) {
        fb.textContent =
          "Enter a valid Solana vote account (base58, 32 – 44 chars).";
      }
      return;
    }
    window.location.href = buildValidatorUrl(parsed.vote, parsed.name);
  };

  if (btn) btn.onclick = go;
  if (inp) {
    inp.addEventListener("keydown", e => {
      if (e.key === "Enter") go();
    });
  }

  try {
    const signals = await fetchSystemSignals();
    const landSig = document.getElementById("landing-system-signals");
    if (landSig) landSig.textContent = formatSystemSignalsText(signals);
  } catch {
    const landSig = document.getElementById("landing-system-signals");
    if (landSig) landSig.textContent = formatSystemSignalsText(null);
  }

  await initValidatorDirectoryEmbed();
}

function escapeHtmlDirectory(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmtStakeDirectory(n) {
  if (!Number.isFinite(n)) return "–";
  return n >= 1000
    ? n.toLocaleString("en-US", { maximumFractionDigits: 0 })
    : n.toFixed(1);
}

/** Stakewiz directory commission: 0–100 = %, above 100 = hundredths (700 → 7%). */
function stakewizCommissionPct(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  return n > 100 ? n / 100 : n;
}

function formatDirectoryCommission(raw) {
  const pct = stakewizCommissionPct(raw);
  if (!Number.isFinite(pct)) return "–";
  return `${Number.isInteger(pct) ? pct : pct.toFixed(1)}%`;
}

function buildDashboardHrefLocal(vote) {
  return `./index.html?${new URLSearchParams({ vote }).toString()}`;
}

function setupReadingGuideToggle() {
  const card = document.getElementById("reading-guide");
  const btn = document.getElementById("reading-guide-toggle");
  if (!card || !btn) return;

  const KEY = "vtd-reading-guide-collapsed";
  /** Default collapsed so the dashboard content leads; expand via Show or persist "0". */
  let collapsed = true;
  try {
    const v = localStorage.getItem(KEY);
    if (v === "0") collapsed = false;
    else if (v === "1") collapsed = true;
  } catch {}

  const apply = () => {
    if (collapsed) {
      card.classList.add("collapsed");
      btn.textContent = "Show";
      btn.setAttribute("aria-expanded", "false");
    } else {
      card.classList.remove("collapsed");
      btn.textContent = "Hide";
      btn.setAttribute("aria-expanded", "true");
    }
  };
  apply();

  btn.addEventListener("click", () => {
    collapsed = !collapsed;
    try {
      localStorage.setItem(KEY, collapsed ? "1" : "0");
    } catch {}
    apply();
  });
}

function setupBackToDirectoryNav() {
  const btn = document.getElementById("nav-back-btn");
  if (!btn) return;

  btn.addEventListener("click", e => {
    const sameOriginReferrer =
      document.referrer &&
      (() => {
        try {
          const u = new URL(document.referrer);
          return (
            u.origin === window.location.origin &&
            (u.pathname.endsWith("/") || u.pathname.endsWith("/index.html")) &&
            !new URLSearchParams(u.search).get("vote")
          );
        } catch {
          return false;
        }
      })();

    if (sameOriginReferrer) {
      e.preventDefault();
      window.history.back();
    }
  });
}

function initialsFromName(name) {
  const trimmed = String(name || "").trim();
  if (!trimmed) return "?";
  const cleaned = trimmed.replace(/[^\p{L}\p{N}\s]/gu, " ").trim();
  if (!cleaned) {
    const ch = [...trimmed][0];
    return ch ? ch.toUpperCase() : "?";
  }
  const parts = cleaned.split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) {
    const word = parts[0];
    const arr = [...word];
    return (arr.slice(0, 2).join("") || word.slice(0, 2)).toUpperCase();
  }
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

function avatarHtml(row) {
  const name = row?.name || "";
  const initials = escapeHtmlDirectory(initialsFromName(name));
  if (row?.image) {
    const safeUrl = escapeHtmlDirectory(row.image);
    const safeAlt = escapeHtmlDirectory(name || "Validator");
    return (
      `<img class="dir-avatar" src="${safeUrl}" alt="${safeAlt}" loading="lazy" ` +
      `onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'dir-avatar-fallback',textContent:'${initials}'}))" />`
    );
  }
  return `<span class="dir-avatar-fallback">${initials}</span>`;
}

function typeaheadAvatarHtml(row) {
  const name = row?.name || "";
  const initials = escapeHtmlDirectory(initialsFromName(name));
  if (row?.image) {
    const safeUrl = escapeHtmlDirectory(row.image);
    const safeAlt = escapeHtmlDirectory(name || "Validator");
    return (
      `<img class="typeahead-avatar" src="${safeUrl}" alt="${safeAlt}" loading="lazy" ` +
      `onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'typeahead-avatar-fallback',textContent:'${initials}'}))" />`
    );
  }
  return `<span class="typeahead-avatar-fallback">${initials}</span>`;
}

/** Rich meta line for directory typeahead (Stakewiz catalog fields). */
function typeaheadDirectoryMetaHtml(r) {
  if (!r) return "";
  const chips = [];
  if (r.delinquent) {
    chips.push('<span class="ta-chip ta-chip-warn">Delinquent</span>');
  }
  if (Number.isFinite(r.rank) && r.rank > 0) {
    chips.push(
      `<span class="ta-chip ta-chip-muted" title="Stakewiz rank by stake">#${escapeHtmlDirectory(String(r.rank))}</span>`
    );
  }
  const commissionPct = stakewizCommissionPct(r.commission);
  if (Number.isFinite(commissionPct)) {
    const band =
      commissionPct >= 50 ? " ta-chip-warn" : commissionPct <= 5 ? " ta-chip-ok" : "";
    chips.push(
      `<span class="ta-chip ta-chip-muted${band}" title="Validator commission">${escapeHtmlDirectory(
        formatDirectoryCommission(r.commission)
      )} fee</span>`
    );
  }
  if (Number.isFinite(r.stake_sol)) {
    chips.push(
      `<span class="ta-chip ta-chip-muted" title="Activated stake (Stakewiz)">${escapeHtmlDirectory(
        fmtStakeDirectory(r.stake_sol)
      )} SOL</span>`
    );
  }
  if (r.is_jito) {
    chips.push(
      '<span class="ta-chip ta-chip-jito" title="Stakewiz: Jito-enabled validator">Jito</span>'
    );
  }
  if (Number.isFinite(r.vote_success_pct)) {
    const vs = r.vote_success_pct;
    const band = vs >= 99 ? " ta-chip-ok" : vs >= 90 ? "" : " ta-chip-warn";
    chips.push(
      `<span class="ta-chip ta-chip-muted${band}" title="Stakewiz vote success">${vs.toFixed(
        1
      )}% votes</span>`
    );
  }
  if (!chips.length) return "";
  return `<div class="typeahead-meta">${chips.join("")}</div>`;
}

function setupValidatorTypeahead({ input, resultsBox, onPick, excludeVote, limit = 48 }) {
  if (!input || !resultsBox) return null;

  let debounceTimer = null;
  let lastQuery = "";
  let activeIdx = -1;
  let currentRows = [];
  let openWithFocus = true;

  const close = () => {
    resultsBox.hidden = true;
    activeIdx = -1;
    currentRows = [];
  };

  const renderRows = rows => {
    currentRows = rows;
    if (!rows.length) {
      resultsBox.innerHTML =
        '<div class="typeahead-empty">No matches. You can still paste a vote account.</div>';
      resultsBox.hidden = false;
      activeIdx = -1;
      return;
    }
    resultsBox.innerHTML = rows
      .map((r, i) => {
        const name = r.name || "(unnamed)";
        const shortVote = r.vote ? `${r.vote.slice(0, 8)}…${r.vote.slice(-5)}` : "";
        const meta = typeaheadDirectoryMetaHtml(r);
        return (
          `<div class="typeahead-row${i === activeIdx ? " is-active" : ""}" data-idx="${i}">` +
            typeaheadAvatarHtml(r) +
            `<div class="typeahead-main">` +
              `<span class="typeahead-name">${escapeHtmlDirectory(name)}</span>` +
              `<span class="typeahead-vote" title="${escapeHtmlDirectory(r.vote || "")}">${escapeHtmlDirectory(shortVote)}</span>` +
              meta +
            `</div>` +
          `</div>`
        );
      })
      .join("");
    resultsBox.hidden = false;
  };

  const setActive = idx => {
    const rows = resultsBox.querySelectorAll(".typeahead-row");
    rows.forEach((el, i) => {
      if (i === idx) el.classList.add("is-active");
      else el.classList.remove("is-active");
    });
    activeIdx = idx;
    if (idx >= 0 && rows[idx]) {
      rows[idx].scrollIntoView({ block: "nearest" });
    }
  };

  const pick = row => {
    if (!row) return;
    close();
    onPick(row);
  };

  const fetchAndRender = async q => {
    try {
      const url = `${API_BASE}/api/validators-directory?limit=${limit}` +
        (q ? `&q=${encodeURIComponent(q)}` : "");
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) {
        close();
        return;
      }
      const json = await res.json().catch(() => ({}));
      let rows = Array.isArray(json?.results) ? json.results : [];
      if (typeof excludeVote === "function") {
        const ex = excludeVote();
        if (ex) rows = rows.filter(r => r.vote !== ex);
      }
      renderRows(rows.slice(0, limit));
    } catch {
      close();
    }
  };

  const onInput = () => {
    const q = String(input.value || "").trim();
    if (q === lastQuery) return;
    lastQuery = q;
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => fetchAndRender(q), 180);
  };

  input.addEventListener("input", onInput);
  input.addEventListener("focus", () => {
    if (!openWithFocus) return;
    const v = String(input.value || "").trim();
    if (v.length >= 32) return;
    fetchAndRender(v);
  });

  input.addEventListener("keydown", e => {
    if (resultsBox.hidden) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      const next = Math.min(currentRows.length - 1, activeIdx + 1);
      setActive(next);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      const prev = Math.max(0, activeIdx - 1);
      setActive(prev);
    } else if (e.key === "Enter") {
      if (activeIdx >= 0 && currentRows[activeIdx]) {
        e.preventDefault();
        pick(currentRows[activeIdx]);
      }
    } else if (e.key === "Escape") {
      close();
    }
  });

  resultsBox.addEventListener("mousedown", e => {
    const rowEl = e.target.closest(".typeahead-row");
    if (!rowEl) return;
    e.preventDefault();
    const idx = Number(rowEl.getAttribute("data-idx"));
    if (Number.isFinite(idx) && currentRows[idx]) pick(currentRows[idx]);
  });

  document.addEventListener("mousedown", e => {
    if (resultsBox.hidden) return;
    if (e.target === input) return;
    if (resultsBox.contains(e.target)) return;
    close();
  });

  return { close, refresh: () => fetchAndRender(String(input.value || "").trim()) };
}

async function initValidatorDirectoryEmbed() {
  const tbody = document.getElementById("directory-tbody");
  const meta = document.getElementById("directory-meta");
  const input = document.getElementById("directory-search");
  const clearBtn = document.getElementById("directory-clear");

  if (!tbody || !meta) return;

  const renderRows = rows => {
    tbody.innerHTML = "";
    if (!rows.length) {
      const tr = document.createElement("tr");
      tr.innerHTML =
        '<td colspan="7" style="color:var(--text3)">No matches. Try another search.</td>';
      tbody.appendChild(tr);
      return;
    }

    for (const r of rows) {
      const name = r.name || "(unnamed)";
      const del = r.delinquent
        ? '<span class="dir-pill dir-pill-warn">Delinquent</span>'
        : '<span class="dir-pill dir-pill-ok">Active</span>';
      const jitoCell =
        r.is_jito === true
          ? `<span class="dir-pill dir-pill-jito" title="Stakewiz: Jito-capable (Jito-enabled client in catalog)">Yes</span>`
          : `<span class="dir-pill-muted" title="Stakewiz: not flagged as Jito-capable">No</span>`;
      const vsCell = Number.isFinite(r.vote_success_pct)
        ? `<span title="Stakewiz vote success – share of votes landed in Stakewiz’s window (not the same as RPC recent voting % on the profile)">${r.vote_success_pct.toFixed(
            1
          )}%</span>`
        : `<span title="No vote-success figure from Stakewiz for this row">–</span>`;
      const tr = document.createElement("tr");
      tr.innerHTML =
        `<td class="dir-name">` +
          `<div class="dir-id-cell">` +
            avatarHtml(r) +
            `<div class="dir-name-block">` +
              `<span class="dir-name-text">${escapeHtmlDirectory(name)}</span>` +
              `<span>${del}</span>` +
            `</div>` +
          `</div>` +
        `</td>` +
        `<td class="dir-vote">${escapeHtmlDirectory(r.vote)}</td>` +
        `<td>${formatDirectoryCommission(r.commission)}</td>` +
        `<td>${fmtStakeDirectory(r.stake_sol)}</td>` +
        `<td class="dir-narrow">${jitoCell}</td>` +
        `<td class="dir-narrow">${vsCell}</td>` +
        `<td><a class="dir-open" href="${buildDashboardHrefLocal(r.vote)}">Open →</a></td>`;
      tbody.appendChild(tr);
    }
  };

  let debounceTimer;

  const runSearch = async q => {
    meta.classList.remove("err");
    meta.textContent = "Searching…";
    try {
      const url = `${API_BASE}/api/validators-directory?q=${encodeURIComponent(q)}&limit=100`;
      const res = await fetch(url);
      const j = await res.json();
      if (!j.ok) throw new Error(j.error || "Request failed");
      meta.textContent =
        `Showing ${j.returned} of ${j.total_catalog} validators in catalog` +
        (q ? ` matching “${q}”` : " (top by stake)") +
        ".";
      renderRows(j.results || []);
    } catch (e) {
      meta.textContent = `Could not load directory: ${e?.message || e}`;
      meta.classList.add("err");
      renderRows([]);
    }
  };

  await runSearch("");

  if (input) {
    input.addEventListener("input", () => {
      clearTimeout(debounceTimer);
      const v = input.value.trim();
      debounceTimer = setTimeout(() => runSearch(v), 280);
    });
  }

  if (clearBtn) {
    clearBtn.onclick = () => {
      if (input) input.value = "";
      runSearch("");
    };
  }

  const hash = window.location.hash.replace(/^#/, "");
  if (hash === "directory" || hash === "directory-section") {
    requestAnimationFrame(() => {
      document.getElementById("directory-section")?.scrollIntoView({
        behavior: "smooth",
        block: "start"
      });
      input?.focus();
    });
  }
}

// ── MAIN ─────────────────────────────────────────
async function main() {
  if (!isProbablyVoteKey(CURRENT.voteKey)) {
    document.documentElement.classList.add("app-landing");
    document.title = "Validator Transparency Dashboard";
    await initLandingPage();
    return;
  }

  document.documentElement.classList.remove("app-landing");

  setupBackToDirectoryNav();
  setupReadingGuideToggle();

  let resolvedDisplayName =
    CURRENT.nameFromUrl || shortKey(CURRENT.voteKey);

  const applyValidatorDisplayName = ratings => {
    const auto = pickValidatorDisplayName(ratings);
    if (CURRENT.nameFromUrl) {
      resolvedDisplayName = CURRENT.nameFromUrl;
    } else if (auto) {
      resolvedDisplayName = auto;
    } else {
      resolvedDisplayName = shortKey(CURRENT.voteKey);
    }

    document.title = `${resolvedDisplayName} · Validator Dashboard`;
    safeSetText(
      document.getElementById("validator-name-head"),
      resolvedDisplayName
    );
    safeSetText(
      document.getElementById("validator-name-badge"),
      `Viewed: ${resolvedDisplayName}`
    );

    const ctx = document.getElementById("current-context");
    if (ctx) {
      if (CURRENT.nameFromUrl) {
        ctx.textContent = "Custom display name from URL (?name=).";
      } else if (auto) {
        ctx.textContent =
          "Loaded from URL – display name from Stakewiz when listed.";
      } else {
        ctx.textContent =
          "Loaded from URL – no directory name yet (showing shortened vote key).";
      }
    }
  };

  document.title = `${resolvedDisplayName} · Validator Dashboard`;

  safeSetText(document.getElementById("validator-name-head"), resolvedDisplayName);
  safeSetText(
    document.getElementById("validator-name-badge"),
    `Viewed: ${resolvedDisplayName}`
  );

  const headerVote = document.getElementById("header-vote-key");
  if (headerVote) {
    headerVote.textContent = CURRENT.voteKey
      ? `Vote account: ${CURRENT.voteKey}`
      : "Vote account: mainnet validator";
  }

  const currentContext = document.getElementById("current-context");
  if (currentContext) {
    currentContext.textContent = CURRENT.nameFromUrl
      ? "Custom display name from URL (?name=)."
      : "Loading directory name…";
  }

  let compareState = null;
  let currentBaseMetrics = null;
  const getShareLink = () =>
    compareState?.voteB
      ? buildCompareUrl(
          CURRENT.voteKey,
          CURRENT.nameFromUrl || "",
          compareState.voteB,
          compareState.nameB || ""
        )
      : buildShareUrl();
  const refreshShareUrl = () => {
    const shareInput = document.getElementById("share-url");
    if (shareInput) shareInput.value = getShareLink();
  };
  const shareInput = document.getElementById("share-url");
  if (shareInput) shareInput.value = getShareLink();
  renderSystemSignals(await fetchSystemSignals());

  const copyBtn = document.getElementById("copy-btn");
  const copyBtnDefault = "Copy URL";
  if (copyBtn) {
    copyBtn.onclick = async () => {
      try {
        await navigator.clipboard.writeText(getShareLink());
        copyBtn.textContent = "Copied!";
      } catch {
        copyBtn.textContent = "Error";
      }
      setTimeout(() => {
        copyBtn.textContent = copyBtnDefault;
      }, 1500);
    };
  }
  wireChangeHistoryExports();

  const openInput = document.getElementById("open-validator-input");
  const openNameInput = document.getElementById("open-validator-name");
  const openBtn = document.getElementById("open-validator-btn");
  const openFeedback = document.getElementById("open-validator-feedback");
  const compareInput = document.getElementById("compare-validator-input");
  const compareBtn = document.getElementById("compare-validator-btn");
  const clearCompareBtn = document.getElementById("clear-compare-btn");
  const compareFeedback = document.getElementById("compare-feedback");
  const comparePanel = document.getElementById("compare-panel");

  const setOpenFeedback = (text, isError = false) => {
    if (!openFeedback) return;
    openFeedback.textContent = text;
    openFeedback.style.color = isError ? "var(--warn)" : "var(--text2)";
  };

  const openValidatorFromInputs = () => {
    const parsed = extractVoteAndNameFromInput(openInput?.value || "");
    const vote = parsed.vote;
    const name = String(openNameInput?.value || parsed.name || "").trim();

    if (!isProbablyVoteKey(vote)) {
      setOpenFeedback("Enter a valid vote account.", true);
      return;
    }

    setOpenFeedback("Opening validator…");
    window.location.assign(buildValidatorUrl(vote, name));
  };

  const setCompareFeedback = (text, isError = false) => {
    if (!compareFeedback) return;
    compareFeedback.textContent = text;
    compareFeedback.style.color = isError ? "var(--warn)" : "var(--text2)";
  };

  if (openBtn) openBtn.onclick = openValidatorFromInputs;
  if (openInput) {
    openInput.addEventListener("keydown", e => {
      if (e.key === "Enter") openValidatorFromInputs();
    });
  }
  if (openNameInput) {
    openNameInput.addEventListener("keydown", e => {
      if (e.key === "Enter") openValidatorFromInputs();
    });
  }

  const runComparison = async voteBValue => {
    if (!isProbablyVoteKey(voteBValue)) {
      setCompareFeedback("Enter a valid vote account.", true);
      return;
    }
    if (voteBValue === CURRENT.voteKey) {
      setCompareFeedback("This is already the currently opened validator.", true);
      return;
    }

    setCompareFeedback("Loading comparison…");
    if (compareBtn) compareBtn.disabled = true;
    if (clearCompareBtn) clearCompareBtn.disabled = true;

    try {
      registerValidatorForTracking(voteBValue).catch(() => {});

      const compareMetrics = await loadComparisonMetrics(voteBValue);
      const safeBaseMetrics = currentBaseMetrics || {
        stabilityScore: null,
        stabilityLabel: "–",
        commission: null,
        uptime: null,
        statusRank: 1,
        statusLabel: "Unknown",
        apyMedian: null,
        poolsCount: null
      };

      compareState = {
        voteB: voteBValue,
        nameB: ""
      };
      refreshShareUrl();

      const url = buildCompareUrl(
        CURRENT.voteKey,
        CURRENT.nameFromUrl || "",
        voteBValue,
        ""
      );
      window.history.replaceState({}, "", url);

      renderComparePanel({
        baseName: resolvedDisplayName,
        compareName: compareMetrics.displayLabel || displayCompareName(voteBValue),
        baseMetrics: safeBaseMetrics,
        compareMetrics
      });

      setCompareFeedback("Comparison ready. Metrics shown side-by-side on this page.");
    } catch (err) {
      console.warn("comparison failed:", err);
      setCompareFeedback("Could not load comparison data right now.", true);
    } finally {
      if (compareBtn) compareBtn.disabled = false;
      if (clearCompareBtn) clearCompareBtn.disabled = false;
    }
  };

  if (compareBtn) {
    compareBtn.onclick = async () => {
      const parsed = extractVoteAndNameFromInput(compareInput?.value || "");
      await runComparison(parsed.vote);
    };
  }
  if (compareInput) {
    compareInput.addEventListener("keydown", async e => {
      if (e.key === "Enter") {
        const parsed = extractVoteAndNameFromInput(compareInput.value || "");
        await runComparison(parsed.vote);
      }
    });
  }
  if (clearCompareBtn) {
    clearCompareBtn.onclick = () => {
      compareState = null;
      if (comparePanel) comparePanel.style.display = "none";
      const whyEl = document.getElementById("compare-why");
      if (whyEl) {
        whyEl.hidden = true;
        whyEl.innerHTML = "";
      }
      if (compareInput) compareInput.value = "";
      setCompareFeedback("Comparison cleared.");
      refreshShareUrl();
      const url = buildValidatorUrl(CURRENT.voteKey, CURRENT.nameFromUrl || "");
      window.history.replaceState({}, "", url);
    };
  }

  const openResults = document.getElementById("open-validator-results");
  const compareResults = document.getElementById("compare-validator-results");

  setupValidatorTypeahead({
    input: openInput,
    resultsBox: openResults,
    excludeVote: () => CURRENT.voteKey,
    onPick: row => {
      if (!row?.vote) return;
      if (openInput) openInput.value = row.vote;
      if (openNameInput && !openNameInput.value && row.name) {
        openNameInput.value = row.name;
      }
      setOpenFeedback(`Selected ${row.name || row.vote.slice(0, 8) + "…"}. Opening…`);
      openValidatorFromInputs();
    }
  });

  setupValidatorTypeahead({
    input: compareInput,
    resultsBox: compareResults,
    excludeVote: () => CURRENT.voteKey,
    onPick: async row => {
      if (!row?.vote) return;
      if (compareInput) compareInput.value = row.vote;
      setCompareFeedback(
        `Selected ${row.name || row.vote.slice(0, 8) + "…"}. Loading comparison…`
      );
      await runComparison(row.vote);
    }
  });

  registerValidatorForTracking(CURRENT.voteKey).catch(err => {
    console.warn("tracking registration error:", err);
  });

  let live;
  try {
    live = USE_LIVE
      ? await fetchLive(CURRENT.voteKey)
      : {
          commissionHistory: Array(10).fill(0),
          uptimeLast5EpochsPct: 99.2,
          jito: true,
          status: "healthy",
          nodePubkey: null,
          epochCreditsLen: 8,
          epochConsistencySeries: [88, 92, 95, 97, 99, 98, 100, 99, 97, 98]
        };
  } catch (err) {
    console.error("fetchLive:", err);
    live = {
      commissionHistory: Array(10).fill(0),
      uptimeLast5EpochsPct: 0,
      jito: false,
      status: "error",
      votePubkey: null,
      nodePubkey: null,
      epochCreditsLen: 0,
      epochConsistencySeries: []
    };
  }

  const statusVal = live.status || "–";
  const statusEl = document.getElementById("status");
  if (statusEl) {
    statusEl.textContent =
      statusVal.charAt(0).toUpperCase() + statusVal.slice(1);
    statusEl.className = `status-big ${statusVal === "healthy" ? "ok" : "warn"}`;
  }

  const jitoBadge = document.getElementById("jito-badge");
  if (jitoBadge) {
    const jitoText = live.jito === true ? "ON" : live.jito === false ? "OFF" : "Unknown";
    jitoBadge.textContent = `Jito ${jitoText}`;
    const mode = live.jito === true ? "upside" : live.jito === false ? "warn" : "info";
    jitoBadge.className = `badge ${mode}`.trim();
  }
  renderRuntimeSources(live);

  const history = live.commissionHistory || [];
  const latestCom = history.length ? Number(history[history.length - 1]) : 0;
  safeSetText(
    document.getElementById("commission"),
    `${Number.isFinite(latestCom) ? latestCom.toFixed(0) : 0}%`
  );
  const commissionEl = document.getElementById("commission");
  if (commissionEl) {
    const cls = ["stat-value"];
    if (Number.isFinite(latestCom) && latestCom >= 50) cls.push("red");
    else if (Number.isFinite(latestCom) && latestCom <= 5) cls.push("green");
    commissionEl.className = cls.join(" ");
  }
  renderCommissionCriticalAlert(latestCom);
  renderCommissionStakerHint(latestCom);

  const uptimeNum = Number(live.uptimeLast5EpochsPct);
  safeSetText(
    document.getElementById("uptime"),
    Number.isFinite(uptimeNum) ? `${uptimeNum.toFixed(1)}%` : "–%"
  );

  const ts = new Date().toLocaleString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    day: "2-digit",
    month: "short"
  });

  safeSetText(document.getElementById("last-updated"), `Last updated: ${ts}`);

  const chartEmpty = document.getElementById("chart-empty");
  if (chartEmpty) {
    chartEmpty.textContent =
      live.epochCreditsLen > 0 && !(live.epochConsistencySeries || []).length
        ? "Not enough completed epochs in the RPC window yet. The in-progress epoch is excluded so it cannot look like a false dip."
        : "No epoch data yet";
  }

  if (live.epochConsistencySeries?.length && window.renderEpochChart) {
    window.renderEpochChart(live.epochConsistencySeries);
  } else if (window.renderEpochChart) {
    window.renderEpochChart([]);
  }

  let ratings = null;
  try {
    ratings = await fetchRatings(CURRENT.voteKey);
    renderRatings(ratings);
    applyValidatorDisplayName(ratings);
  } catch (e) {
    console.warn("ratings failed:", e);
    applyValidatorDisplayName(null);
  }

  renderRecentPerformance(computeRecentPerformance({ live, ratings }));

  const poolsCount = Array.isArray(ratings?.pools?.stake_pools)
    ? ratings.pools.stake_pools.length
    : null;
  const apyMedian = Number(ratings?.derived?.apy_median);

  renderDelegatorSnapshotStrip({
    live,
    stability: null,
    latestCom,
    uptimeNum,
    poolsCount: Number.isFinite(poolsCount) ? poolsCount : null,
    apyMedian: Number.isFinite(apyMedian) ? apyMedian : null
  });

  renderUpsideSignals({ live, latestCom, uptimeNum, poolsCount, apyMedian });

  const { snapshots: snaps, meta: snapshotMeta } = await loadSnapshotsFromDB(
    CURRENT.voteKey
  );
  const stability = computeStability({ live, ratings, poolsCount, snaps, snapshotMeta });
  renderStability(stability);
  renderDelegatorSnapshotStrip({
    live,
    stability,
    latestCom,
    uptimeNum,
    poolsCount: Number.isFinite(poolsCount) ? poolsCount : null,
    apyMedian: Number.isFinite(apyMedian) ? apyMedian : null
  });
  renderDelegatorAssessment(
    computeDelegatorAssessment({ live, ratings, poolsCount, snaps, stability })
  );

  const whatChanged = computeWhatChanged({
    snaps,
    live,
    stability,
    snapshotMeta
  });
  renderWhatChanged(whatChanged);
  setChangeHistoryExportContext({
    voteKey: CURRENT.voteKey,
    name: resolvedDisplayName,
    whatChanged,
    shareUrl: getShareLink()
  });

  const baseStatus = normalizeStatusForCompare(live?.status);
  const baseMetrics = {
    stabilityScore: Number.isFinite(stability.allTimeScore) ? stability.allTimeScore : stability.score,
    stabilityLabel: Number.isFinite(stability.allTimeScore) ? stability.allTimeLabel : stability.label,
    commission: Number.isFinite(latestCom) ? latestCom : null,
    uptime: Number.isFinite(uptimeNum) ? uptimeNum : null,
    statusRank: baseStatus.rank,
    statusLabel: baseStatus.label,
    apyMedian: Number.isFinite(apyMedian) ? apyMedian : null,
    poolsCount: Number.isFinite(poolsCount) ? poolsCount : null
  };
  currentBaseMetrics = baseMetrics;

  loadNetworkStats().then(networkStats => {
    try {
      const verdict = computeVerdict({
        stability,
        snapshotMeta,
        liveStatus: live?.status,
        recentVotingPct: Number.isFinite(uptimeNum) ? uptimeNum : null,
        commission: Number.isFinite(latestCom) ? latestCom : null,
        apy: Number.isFinite(apyMedian) ? apyMedian : null,
        poolsCount: Number.isFinite(poolsCount) ? poolsCount : null,
        networkStats
      });
      renderVerdictBadge(verdict);

      if (networkStats?.stats) {
        setVsNetworkSubtext(
          document.getElementById("commission"),
          formatVsNetworkText({
            value: Number.isFinite(latestCom) ? latestCom : NaN,
            stats: networkStats.stats.commission,
            mode: "lower",
            unit: "%",
            decimals: 0
          })
        );

        setVsNetworkSubtext(
          document.getElementById("apy-median"),
          formatVsNetworkText({
            value: Number.isFinite(apyMedian) ? apyMedian : NaN,
            stats: networkStats.stats.apy,
            mode: "higher",
            unit: "%",
            decimals: 2
          })
        );

        if (Number.isFinite(networkStats.delinquent_pct)) {
          const uptimeEl = document.getElementById("uptime");
          if (uptimeEl) {
            const txt =
              `Network context: ${networkStats.delinquent_pct.toFixed(1)}% of validators are currently delinquent · ` +
              `~99 – 100% recent voting is the norm for a healthy validator`;
            setVsNetworkSubtext(uptimeEl, txt);
          }
        }
      }
    } catch (err) {
      console.warn("verdict render failed:", err);
    }
  });

  if (COMPARE_FROM_URL.voteKey && isProbablyVoteKey(COMPARE_FROM_URL.voteKey)) {
    if (compareInput) compareInput.value = COMPARE_FROM_URL.voteKey;
    setCompareFeedback("Loading comparison from URL…");
    if (compareBtn) compareBtn.disabled = true;
    try {
      registerValidatorForTracking(COMPARE_FROM_URL.voteKey).catch(() => {});
      const compareMetrics = await loadComparisonMetrics(COMPARE_FROM_URL.voteKey);
      compareState = {
        voteB: COMPARE_FROM_URL.voteKey,
        nameB: COMPARE_FROM_URL.name || ""
      };
      renderComparePanel({
        baseName: resolvedDisplayName,
        compareName:
          COMPARE_FROM_URL.name ||
          compareMetrics.displayLabel ||
          displayCompareName(COMPARE_FROM_URL.voteKey),
        baseMetrics,
        compareMetrics
      });
      setCompareFeedback("Comparison loaded from URL.");
      refreshShareUrl();
    } catch (err) {
      console.warn("url comparison failed:", err);
      setCompareFeedback("Could not load comparison from URL.", true);
    } finally {
      if (compareBtn) compareBtn.disabled = false;
    }
  } else {
    if (compareInput && !compareInput.value) compareInput.value = "";
    setCompareFeedback("Compare this opened validator against another vote account.");
  }
}

main();
