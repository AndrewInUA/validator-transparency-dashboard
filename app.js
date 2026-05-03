/**
 * Validator Transparency Dashboard – app.js v46
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

/** Public catalog name (e.g. Stakewiz) — not on-chain; optional ?name= still overrides. */
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
  safeSetText(document.getElementById("apy-median-2"), fmtPct(median));
  safeSetText(
    document.getElementById("pools-count"),
    pools.length ? String(pools.length) : "–"
  );
  safeSetText(
    document.getElementById("pools-count-kpi"),
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
    epochConsistencySeries: []
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

    try {
      // Each epochCredits row maps to one chart point (normalized vs max delta in window).
      // The LAST row is usually the *current* epoch: credits are still accumulating, so
      // consistency looks artificially low — exclude it from chart + headline uptime.
      const deltas = credits
        .map(epochEarnedCredits)
        .filter(v => Number.isFinite(v));

      const recent = deltas.slice(-30);
      let fullSeries = [];
      if (recent.length) {
        const maxD = Math.max(...recent, 1);
        fullSeries = recent.map(
          d => Math.round((d / maxD) * 10000) / 100
        );
      }

      if (fullSeries.length > 1) {
        epochConsistencySeries = fullSeries.slice(0, -1);
      } else if (fullSeries.length === 1) {
        epochConsistencySeries = [];
      } else {
        epochConsistencySeries = [];
      }

      const completedForUptime =
        fullSeries.length > 1 ? fullSeries.slice(0, -1) : [];
      const last5 = completedForUptime.slice(-5);
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
      epochConsistencySeries
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
      out.window.sub = `${n} recent epochs visible — a reasonable short-term slice.`;
    } else {
      out.window.sub = `${n} recent epochs visible — solid coverage for a short-term view.`;
    }
  }

  if (n >= 4 && Number.isFinite(diff)) {
    if (rel.level === "very_low" || rel.level === "low") {
      out.trend.value = "Not enough data";
      out.trend.sub = `Only ${n} epochs to compare — too few to call a trend confidently.`;
    } else if (diff >= 3) {
      out.trend.value = "Improving";
      out.trend.sub = "Newer epochs look stronger than older ones in this window — good direction.";
    } else if (diff <= -3) {
      out.trend.value = "Getting worse";
      out.trend.sub = "Newer epochs look weaker than older ones — recent yellow flag, worth watching.";
    } else {
      out.trend.value = "Steady";
      out.trend.sub = "Newer and older epochs look about the same — no recent change either way.";
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
        ? "Epochs look very similar to each other — but the sample is short, so check again later."
        : "Epochs look very similar to each other — predictable behavior.";
    } else if (volatility <= 12) {
      out.variability.value = "Some bumps";
      out.variability.sub = smallSample
        ? "Some ups and downs between epochs; small sample can look noisier than reality."
        : "Some ups and downs between epochs, but no wild swings.";
    } else {
      out.variability.value = "Choppy";
      out.variability.sub =
        "Big jumps between epochs in this window — less predictable short-term behavior." +
        (smallSample ? " Still a short sample — re-check as more epochs come in." : "");
    }
  }

  const rp = [];
  rp.push(
    jito === true
      ? "Jito ON usually means delegators can get a bit more on top of base staking rewards (MEV)."
      : jito === false
        ? "Jito OFF in public data — expect baseline staking rewards without the Jito uplift."
        : "Jito signal is temporarily unavailable, so we can’t confirm this part of rewards right now."
  );
  if (Number.isFinite(apyMedian)) {
    rp.push(
      `Estimated APY ~${apyMedian.toFixed(2)}% (blended from public sources — planning context only, not a guarantee).`
    );
  }
  rp.push(
    Number.isFinite(sw) && Number.isFinite(tr)
      ? Math.abs(sw - tr) <= 1
        ? "APY estimates from Stakewiz and Trillium agree closely — higher confidence."
        : "APY estimates from Stakewiz and Trillium disagree — lower confidence in the exact number."
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

// ── STABILITY ─────────────────────────────────────
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

  function scoreFromRecentSignals(sampleCount, delinquent, commissionShift) {
    // Recent score: hybrid signal (history window + current/live context).
    let s = 100;
    if (nowStatus === "delinquent") s -= 40;
    s -= (sampleCount ? (delinquent / sampleCount) * 40 : 0);
    s -= clamp(commissionShift * 5, 0, 20);
    if (Number.isFinite(nowUptime) && nowUptime < 95) {
      s -= clamp((95 - nowUptime) * 1.5, 0, 20);
    }
    if (apyDiff !== null && apyDiff > 1) {
      s -= clamp((apyDiff - 1) * 5, 0, 15);
    }
    if (!Number.isFinite(poolsCount) || poolsCount <= 0) s -= 10;
    return clamp(Math.round(s), 0, 100);
  }

  function scoreFromAllTimeSnapshots(sampleCount, delinquent, commissionShift) {
    // All-time score: snapshot-history only (no live/API side inputs).
    let s = 100;
    s -= (sampleCount ? (delinquent / sampleCount) * 40 : 0);
    s -= clamp(commissionShift * 5, 0, 20);
    return clamp(Math.round(s), 0, 100);
  }

  let score = scoreFromRecentSignals(n, delinquentCount, commissionChanges);

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
    allTimeMetaLine = `All-time: ${totalAll.toLocaleString("en-US")} snapshots (${o} - ${ne}).`;
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
    ok: signalSample >= 2 ? signalCommissionChanges === 0 : false,
    text:
      signalSample >= 2
        ? signalCommissionChanges === 0
          ? `Commission stable in ${signalScope}`
          : `Commission changes in ${signalScope}: ${signalCommissionChanges}`
        : "Commission-change signal waiting for more snapshots",
    tip: "Snapshot-only signal from stored commission history."
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
      allTimeCommissionChanges
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

function pushUnique(list, text) {
  if (!text) return;
  if (!list.includes(text)) list.push(text);
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
      pushUnique(
        positives,
        "0% validator commission: delegators keep more baseline staking rewards."
      );
    } else if (latestCommission <= 5) {
      signalPoints += 1;
      pushUnique(
        positives,
        `Low validator commission (${latestCommission.toFixed(0)}%) supports net yield.`
      );
    } else if (latestCommission >= 100) {
      signalPoints -= 6;
      commissionCriticalRisk = true;
      pushUnique(
        cautions,
        "Validator commission is 100%: direct delegators typically receive near-zero net staking rewards."
      );
    } else if (latestCommission >= 50) {
      signalPoints -= 3;
      pushUnique(
        cautions,
        `Very high validator commission (${latestCommission.toFixed(0)}%) heavily reduces delegator net rewards.`
      );
    } else if (latestCommission > 10) {
      signalPoints -= 2;
      pushUnique(
        cautions,
        `High validator commission (${latestCommission.toFixed(0)}%) reduces delegator net rewards.`
      );
    } else {
      signalPoints -= 1;
      pushUnique(
        cautions,
        `Higher validator commission (${latestCommission.toFixed(0)}%) reduces net delegator rewards.`
      );
    }
  }

  if (status === "healthy") {
    signalPoints += 2;
    pushUnique(positives, "Live status is healthy right now.");
  } else if (status === "delinquent") {
    signalPoints -= 3;
    pushUnique(cautions, "Live status is delinquent right now.");
  } else if (status !== "unknown") {
    signalPoints -= 1;
    pushUnique(cautions, `Live status is ${status}.`);
  }

  if (Number.isFinite(uptime)) {
    if (uptime >= 95) {
      signalPoints += 2;
      pushUnique(positives, `Recent voting consistency is strong (${uptime.toFixed(1)}%).`);
    } else if (uptime >= 90) {
      signalPoints += 1;
      pushUnique(positives, `Recent voting consistency is solid (${uptime.toFixed(1)}%).`);
    } else {
      signalPoints -= 2;
      pushUnique(cautions, `Recent voting consistency is weaker (${uptime.toFixed(1)}%).`);
    }
  }

  if (Number.isFinite(stabilityScore)) {
    if (stabilityScore >= 85) {
      signalPoints += 2;
      pushUnique(positives, `Stability score is strong (${stabilityScore}/100).`);
    } else if (stabilityScore >= 70) {
      signalPoints += 1;
      pushUnique(positives, `Stability score is good (${stabilityScore}/100).`);
    } else if (stabilityScore < 50) {
      signalPoints -= 2;
      pushUnique(cautions, `Stability score is low (${stabilityScore}/100).`);
    } else {
      signalPoints -= 1;
      pushUnique(cautions, `Stability score is mixed (${stabilityScore}/100).`);
    }
  }

  if (snapCount >= 24) {
    signalPoints += 1;
    pushUnique(
      positives,
      `History depth is meaningful (${snapCount} recent snapshots in this assessment window).`
    );
  } else if (snapCount < 8) {
    signalPoints -= 1;
    pushUnique(
      cautions,
      `History is still short (${snapCount} recent snapshots), so confidence is lower.`
    );
  }

  if (jito === true) {
    signalPoints += 1;
    pushUnique(
      positives,
      "Jito signal is ON, so additional reward upside may be possible."
    );
  } else if (jito === false) {
    pushUnique(
      cautions,
      "Jito signal is OFF, so rewards are likely closer to baseline staking yield."
    );
  }

  if (Number.isFinite(apyMedian)) {
    pushUnique(
      positives,
      `Estimated APY context is available (~${apyMedian.toFixed(2)}%).`
    );
  } else {
    pushUnique(cautions, "APY estimate is unavailable right now.");
  }

  if (Number.isFinite(poolsCount) && poolsCount > 0) {
    signalPoints += 1;
    pushUnique(
      positives,
      `${poolsCount} stake pools delegate here, showing broader ecosystem usage.`
    );
  } else {
    signalPoints -= 1;
    pushUnique(cautions, "No current stake pool presence was detected.");
  }

  const verdict = commissionCriticalRisk
    ? { label: "Caution", className: "warn" }
    : signalPoints >= 6
      ? { label: "Attractive", className: "ok" }
      : signalPoints >= 2
        ? { label: "Balanced", className: "ok" }
        : { label: "Caution", className: "warn" };

  const confidence =
    snapCount >= 48
      ? "High"
      : snapCount >= 12
        ? "Medium"
        : "Low";

  const summary =
    commissionCriticalRisk
      ? "Commission is critically high for direct delegation, so this validator is currently a caution case despite other positive signals."
      : verdict.label === "Attractive"
      ? "Most displayed signals currently support this validator for delegator consideration."
      : verdict.label === "Balanced"
        ? "Signals are mixed to positive; reasonable option, but review the watch list before delegating."
        : "Several warning signals are active; review carefully before delegating.";

  return {
    verdict,
    summary,
    confidence,
    positives: positives.slice(0, 4),
    cautions: cautions.slice(0, 4)
  };
}

function renderDelegatorAssessment(assessment) {
  safeSetText(document.getElementById("delegator-summary"), assessment.summary);
  safeSetText(
    document.getElementById("delegator-confidence"),
    `Confidence: ${assessment.confidence} (snapshot depth for this vote account and signal coverage; network-wide collection does not shortcut history length).`
  );

  const verdictEl = document.getElementById("delegator-verdict");
  if (verdictEl) {
    verdictEl.textContent = assessment.verdict.label;
    verdictEl.className = `status-big ${assessment.verdict.className}`;
  }

  const goodEl = document.getElementById("delegator-good");
  if (goodEl) {
    goodEl.innerHTML = "";
    const items = assessment.positives.length
      ? assessment.positives
      : ["No strong positive signals yet."];
    for (const text of items) {
      const pill = document.createElement("span");
      pill.className = "pill pill-ok";
      pill.textContent = text;
      goodEl.appendChild(pill);
    }
  }

  const watchEl = document.getElementById("delegator-watch");
  if (watchEl) {
    watchEl.innerHTML = "";
    const items = assessment.cautions.length
      ? assessment.cautions
      : ["No major warning signals right now."];
    for (const text of items) {
      const pill = document.createElement("span");
      pill.className = assessment.cautions.length ? "pill pill-warn" : "pill pill-ok";
      pill.textContent = text;
      watchEl.appendChild(pill);
    }
  }
}

function renderCommissionCriticalAlert(commissionPct) {
  const el = document.getElementById("commission-critical-alert");
  if (!el) return;

  if (Number.isFinite(commissionPct) && commissionPct >= 100) {
    el.style.display = "block";
    el.innerHTML =
      "<strong>Critical delegator warning:</strong> this validator currently has 100% commission. " +
      "For direct delegation, this usually means near-zero net staking rewards for delegators. " +
      "Proceed only if you intentionally accept this setup.";
    return;
  }

  if (Number.isFinite(commissionPct) && commissionPct >= 50) {
    el.style.display = "block";
    el.innerHTML =
      `<strong>High commission warning:</strong> current validator commission is ${commissionPct.toFixed(0)}%. ` +
      "This can significantly reduce delegator net rewards.";
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
  const nameAEl = document.getElementById("compare-name-a");
  const nameBEl = document.getElementById("compare-name-b");
  if (!panel || !rowsEl || !summaryEl) return;

  if (nameAEl) nameAEl.textContent = `Validator A (${baseName || "Current"})`;
  if (nameBEl) nameBEl.textContent = `Validator B (${compareName || "Compared"})`;

  const rows = [
    {
      metric: "Stability score",
      currentText: formatScoreText(baseMetrics.stabilityScore, baseMetrics.stabilityLabel),
      compareText: formatScoreText(compareMetrics.stabilityScore, compareMetrics.stabilityLabel),
      currentValue: baseMetrics.stabilityScore,
      compareValue: compareMetrics.stabilityScore,
      mode: "higher"
    },
    {
      metric: "Commission",
      currentText: Number.isFinite(baseMetrics.commission) ? `${baseMetrics.commission.toFixed(0)}%` : "–",
      compareText: Number.isFinite(compareMetrics.commission) ? `${compareMetrics.commission.toFixed(0)}%` : "–",
      currentValue: baseMetrics.commission,
      compareValue: compareMetrics.commission,
      mode: "lower"
    },
    {
      metric: "Recent voting consistency",
      currentText: Number.isFinite(baseMetrics.uptime) ? `${baseMetrics.uptime.toFixed(1)}%` : "–",
      compareText: Number.isFinite(compareMetrics.uptime) ? `${compareMetrics.uptime.toFixed(1)}%` : "–",
      currentValue: baseMetrics.uptime,
      compareValue: compareMetrics.uptime,
      mode: "higher"
    },
    {
      metric: "Live status",
      currentText: baseMetrics.statusLabel,
      compareText: compareMetrics.statusLabel,
      currentValue: baseMetrics.statusRank,
      compareValue: compareMetrics.statusRank,
      mode: "status"
    },
    {
      metric: "APY (median)",
      currentText: Number.isFinite(baseMetrics.apyMedian) ? `${baseMetrics.apyMedian.toFixed(2)}%` : "–",
      compareText: Number.isFinite(compareMetrics.apyMedian) ? `${compareMetrics.apyMedian.toFixed(2)}%` : "–",
      currentValue: baseMetrics.apyMedian,
      compareValue: compareMetrics.apyMedian,
      mode: "higher"
    },
    {
      metric: "Pools delegating",
      currentText: Number.isFinite(baseMetrics.poolsCount) ? String(baseMetrics.poolsCount) : "–",
      compareText: Number.isFinite(compareMetrics.poolsCount) ? String(compareMetrics.poolsCount) : "–",
      currentValue: baseMetrics.poolsCount,
      compareValue: compareMetrics.poolsCount,
      mode: "higher"
    }
  ];

  rowsEl.innerHTML = "";
  const wins = { left: 0, right: 0, tie: 0 };

  for (const r of rows) {
    const better = compareBetter(r.currentValue, r.compareValue, r.mode);
    if (better === "left") wins.left += 1;
    else if (better === "right") wins.right += 1;
    else wins.tie += 1;

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

  if (wins.left === wins.right) {
    summaryEl.textContent = "Overall: both validators look similar on these visible metrics.";
  } else if (wins.left > wins.right) {
    summaryEl.textContent = "Overall: Validator A looks stronger on more visible metrics in this quick comparison.";
  } else {
    summaryEl.textContent = "Overall: Validator B looks stronger on more visible metrics in this quick comparison.";
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
          "Enter a valid Solana vote account (base58, 32–44 chars), or paste a link that includes vote=.";
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

function buildDashboardHrefLocal(vote) {
  return `./index.html?${new URLSearchParams({ vote }).toString()}`;
}

function setupReadingGuideToggle() {
  const card = document.getElementById("reading-guide");
  const btn = document.getElementById("reading-guide-toggle");
  if (!card || !btn) return;

  const KEY = "vtd-reading-guide-collapsed";
  let collapsed = false;
  try {
    collapsed = localStorage.getItem(KEY) === "1";
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
        '<td colspan="5" style="color:var(--text3)">No matches. Try another search.</td>';
      tbody.appendChild(tr);
      return;
    }

    for (const r of rows) {
      const name = r.name || "(unnamed)";
      const del = r.delinquent
        ? '<span class="dir-pill dir-pill-warn">Delinquent</span>'
        : '<span class="dir-pill dir-pill-ok">Active</span>';
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
        `<td>${Number.isFinite(r.commission) ? `${r.commission}%` : "–"}</td>` +
        `<td>${fmtStakeDirectory(r.stake_sol)}</td>` +
        `<td><a class="dir-open" href="${buildDashboardHrefLocal(r.vote)}">Open →</a></td>`;
      tbody.appendChild(tr);
    }
  };

  let debounceTimer;

  const runSearch = async q => {
    meta.classList.remove("err");
    meta.textContent = "Searching…";
    try {
      const url = `${API_BASE}/api/validators-directory?q=${encodeURIComponent(q)}&limit=60`;
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
          "Loaded from URL — display name from Stakewiz when listed.";
      } else {
        ctx.textContent =
          "Loaded from URL — no directory name yet (showing shortened vote key).";
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
      setOpenFeedback(
        "Enter a valid vote account, or paste a dashboard link that includes ?vote=.",
        true
      );
      return;
    }

    setOpenFeedback("Opening validator…");
    const targetUrl = buildValidatorUrl(vote, name);
    const opened = window.open(targetUrl, "_blank", "noopener,noreferrer");
    if (!opened) {
      setOpenFeedback(
        "Popup blocked by browser. Allow popups for this site to open validator in a new tab.",
        true
      );
      return;
    }
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
      setCompareFeedback(
        "Enter a valid vote account (or a dashboard URL that includes vote=).",
        true
      );
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
      if (compareInput) compareInput.value = "";
      setCompareFeedback("Comparison cleared.");
      refreshShareUrl();
      const url = buildValidatorUrl(CURRENT.voteKey, CURRENT.nameFromUrl || "");
      window.history.replaceState({}, "", url);
    };
  }

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

  renderUpsideSignals({ live, latestCom, uptimeNum, poolsCount, apyMedian });

  const { snapshots: snaps, meta: snapshotMeta } = await loadSnapshotsFromDB(
    CURRENT.voteKey
  );
  const stability = computeStability({ live, ratings, poolsCount, snaps, snapshotMeta });
  renderStability(stability);
  renderDelegatorAssessment(
    computeDelegatorAssessment({ live, ratings, poolsCount, snaps, stability })
  );

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
