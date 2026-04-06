/**
 * Validator Transparency Dashboard – app.js v38
 * Backend-only snapshot model:
 * page open -> /api/track-validator -> tracked_validators
 * CRON -> /api/collect -> Supabase -> frontend reads only
 */

const USE_LIVE = true;

const VALIDATOR = {
  name: "AndrewInUA",
  voteKey: "3QPGLackJy5LKctYYoPGmA4P8ncyE197jdxr1zP2ho8K"
};

const API_BASE = window.location.hostname.includes("github.io")
  ? "https://validator-transparency-dashboard.vercel.app"
  : "";

const JITO_PROXY = `${API_BASE}/api/jito`;
const SNAPSHOTS_API = `${API_BASE}/api/snapshots`;
const TRACK_VALIDATOR_API = `${API_BASE}/api/track-validator`;
const RPC_PROXY_API = `${API_BASE}/api/rpc`;
const ENV_CHECK_API = `${API_BASE}/api/env-check`;

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
    voteKey: vote.length ? vote : VALIDATOR.voteKey,
    name: name.length ? name : VALIDATOR.name,
    voteFromUrl: vote.length ? vote : null,
    nameFromUrl: name.length ? name : null
  };
}

const CURRENT = computeCurrentValidator();

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
  const base = `${window.location.origin}${window.location.pathname}`;
  const isGHP = window.location.hostname.includes("github.io");
  const params = new URLSearchParams();

  params.set("vote", CURRENT.voteKey);
  if (CURRENT.nameFromUrl) params.set("name", CURRENT.nameFromUrl);

  return isGHP ? `${base}#${params.toString()}` : `${base}?${params.toString()}`;
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
  safeSetText(
    document.getElementById("pools-totals"),
    `Stake from pools: ${fmtSol(
      r?.pools?.total_from_stake_pools
    )} SOL • Not from pools: ${fmtSol(r?.pools?.total_not_from_stake_pools)} SOL`
  );

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
      const deltas = [];
      for (let i = 1; i < credits.length; i++) {
        deltas.push(Math.max(0, (credits[i]?.[1] ?? 0) - (credits[i - 1]?.[1] ?? 0)));
      }
      const recent = deltas.slice(-30);
      if (recent.length) {
        const maxD = Math.max(...recent, 1);
        epochConsistencySeries = recent.map(d => Math.round((d / maxD) * 10000) / 100);
      }

      const last5 = epochConsistencySeries.slice(-5);
      uptimePct = last5.length
        ? Math.round((last5.reduce((s, x) => s + x, 0) / last5.length) * 100) / 100
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
async function loadSnapshotsFromDB(voteKey) {
  try {
    const res = await fetch(
      `${SNAPSHOTS_API}?vote=${encodeURIComponent(voteKey)}&limit=120`
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const json = await res.json();
    return Array.isArray(json?.snapshots) ? json.snapshots : [];
  } catch (err) {
    console.warn("DB load failed:", err);
    return [];
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

function renderSystemSignals(signals) {
  const el = document.getElementById("system-signals");
  if (!el) return;
  if (!signals) {
    el.textContent = "System signals: unavailable";
    return;
  }
  const asWord = v => (v ? "ON" : "OFF");
  el.textContent =
    `System signals: Alpha ${asWord(signals.alpha)} · ` +
    `Bravo ${asWord(signals.bravo)} · ` +
    `Charlie ${asWord(signals.charlie)} · ` +
    `Delta ${asWord(signals.delta)}`;
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
    window: { value: "–", sub: "Waiting for recent epoch data from the network." },
    trend: { value: "–", sub: "Not enough epochs to compare yet." },
    variability: { value: "–", sub: "Not enough epochs to measure spread yet." },
    reward: { value: jito === true ? "Jito ON" : jito === false ? "Jito OFF" : "Jito unknown", sub: "–" }
  };

  const smallSample = rel.level === "very_low" || rel.level === "low";

  if (n > 0) {
    out.window.value = `${n} epoch${n === 1 ? "" : "s"}`;
    if (rel.level === "very_low") {
      out.window.sub = `This block can use up to 30 recent epochs; only ${n} ${n === 1 ? "is" : "are"} available. Use it as a quick peek, not a full story.`;
    } else if (rel.level === "low") {
      out.window.sub = `Up to 30 epochs are considered; ${n} are in view, enough for a rough read, not a long track record.`;
    } else if (rel.level === "medium") {
      out.window.sub = `${n} epochs in view – a reasonable slice for short-term context.`;
    } else {
      out.window.sub = `${n} epochs in view – good coverage for this summary.`;
    }
  }

  if (n >= 4 && Number.isFinite(diff)) {
    const s = simplifyTrendDelta(diff);
    const cap = s ? s[0].toUpperCase() + s.slice(1) : "";

    if (rel.level === "very_low" || rel.level === "low") {
      out.trend.value = "Limited data";
      out.trend.sub = `We compare the newer half of these ${n} epochs to the older half; with so few points the trend is unreliable – check again as history grows.`;
    } else if (diff >= 3) {
      out.trend.value = "Improving";
      out.trend.sub = `${cap} stronger voting activity in the newer part of this window than in the older part.`;
    } else if (diff <= -3) {
      out.trend.value = "Declining";
      out.trend.sub = `${cap} weaker voting activity in the newer part of this window than in the older part.`;
    } else {
      out.trend.value = "Stable";
      out.trend.sub = "Newer and older epochs in this window look broadly similar.";
    }
  } else if (n > 0) {
    out.trend.value = "Limited data";
    out.trend.sub =
      n < 4
        ? "Need at least four epochs before we can split the window into “newer” vs “older” fairly."
        : "Not enough signal to describe a trend.";
  }

  if (n >= 2 && Number.isFinite(volatility)) {
    if (volatility <= 5) {
      out.variability.value = "Low";
      out.variability.sub = smallSample
        ? "Numbers stay close together in this short window – the range can look smaller than it really is until more epochs arrive."
        : "Epoch-to-epoch values sit fairly close together.";
    } else if (volatility <= 12) {
      out.variability.value = "Moderate";
      out.variability.sub = smallSample
        ? "Some bounce between epochs; with few data points this can look noisier than it really is."
        : "Clear ups and downs, but not wild swings.";
    } else {
      out.variability.value = "High";
      out.variability.sub =
        "Large differences between epochs in this window." +
        (smallSample ? " Still a short sample – confirm with more history." : "");
    }
  }

  const rp = [];
  rp.push(
    jito === true
      ? "Public signals suggest Jito-style rewards may apply (check current network docs)."
      : jito === false
        ? "No Jito-style reward flag seen in the public signals we read."
        : "Jito status temporarily unavailable from proxy; check again shortly."
  );
  if (Number.isFinite(apyMedian)) {
    rp.push(`Blended APY hint (median of public feeds): ~${apyMedian.toFixed(2)}% – not a guaranteed return.`);
  }
  rp.push(
    Number.isFinite(sw) && Number.isFinite(tr)
      ? Math.abs(sw - tr) <= 1
        ? "Stakewiz and Trillium are close on APY right now."
        : "Stakewiz and Trillium disagree on APY – treat estimates as rough."
      : "One or both APY feeds missing – yield context is thin."
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
function computeStability({ live, ratings, poolsCount, snaps }) {
  const n = snaps.length;
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

  let score = 100;
  if (nowStatus === "delinquent") score -= 40;
  score -= (n ? (delinquentCount / n) * 40 : 0);
  score -= clamp(commissionChanges * 5, 0, 20);
  if (Number.isFinite(nowUptime) && nowUptime < 95) {
    score -= clamp((95 - nowUptime) * 1.5, 0, 20);
  }
  if (apyDiff !== null && apyDiff > 1) {
    score -= clamp((apyDiff - 1) * 5, 0, 15);
  }
  if (!Number.isFinite(poolsCount) || poolsCount <= 0) score -= 10;

  score = clamp(Math.round(score), 0, 100);

  const label =
    score >= 85 ? "Strong" :
    score >= 70 ? "Good" :
    score >= 50 ? "Watch" :
    "Risk";

  let trackingText = "Not enough history";
  let trackingNote = "Waiting for backend snapshots to build history.";

  if (n >= 2) {
    const t0 = new Date(snaps[0].captured_at || Date.now()).getTime();
    const t1 = new Date(snaps[n - 1].captured_at || Date.now()).getTime();
    const days = Math.max(0, (t1 - t0) / (24 * 3600 * 1000));

    trackingText =
      days >= 1
        ? `${Math.round(days)}d`
        : `${Math.max(1, Math.round(days * 24))}h`;

    trackingNote = `${n} backend snapshots over ${trackingText}. Shared history for this validator.`;
  } else if (n === 1) {
    trackingText = "1 snapshot";
    trackingNote =
      "Backend history has started, but it is still too short for stronger conclusions.";
  }

  const pills = [];

  if (n >= 2) {
    pills.push({
      ok: delinquentCount === 0,
      text:
        delinquentCount === 0
          ? "No delinquency in snapshot history"
          : `Delinquency seen (${delinquentCount}/${n})`,
      tip: "Based on backend-collected snapshots."
    });
  } else {
    pills.push({
      ok: nowStatus === "healthy",
      text: nowStatus === "healthy" ? "Healthy right now" : `Status: ${nowStatus}`,
      tip: "Current live status."
    });
  }

  if (n >= 2) {
    pills.push({
      ok: commissionChanges === 0,
      text:
        commissionChanges === 0
          ? "Commission stable"
          : `Commission changed ${commissionChanges}x`,
      tip: "Based on backend-collected snapshots."
    });
  } else {
    pills.push({
      ok: true,
      text: "Commission history building",
      tip: "Needs more backend snapshots."
    });
  }

  if (apyDiff === null) {
    pills.push({
      ok: false,
      text: "APY comparison unavailable",
      tip: "Needs both APY sources."
    });
  } else if (apyDiff <= 0.75) {
    pills.push({
      ok: true,
      text: `APY sources consistent (Δ ${apyDiff.toFixed(2)}%)`,
      tip: "APY inputs closely aligned."
    });
  } else if (apyDiff <= 1.5) {
    pills.push({
      ok: true,
      text: `APY fairly close (Δ ${apyDiff.toFixed(2)}%)`,
      tip: "Moderate APY difference."
    });
  } else {
    pills.push({
      ok: false,
      text: `APY disagreement (Δ ${apyDiff.toFixed(2)}%)`,
      tip: "Large APY difference."
    });
  }

  const uptimeOk = Number.isFinite(nowUptime) && nowUptime >= 90;
  pills.push({
    ok: uptimeOk,
    text: !Number.isFinite(nowUptime)
      ? "Recent voting data unavailable"
      : nowUptime >= 95
        ? `Recent voting consistency strong (${nowUptime.toFixed(1)}%)`
        : nowUptime >= 90
          ? `Recent voting consistency good (${nowUptime.toFixed(1)}%)`
          : `Recent voting consistency needs attention (${nowUptime.toFixed(1)}%)`,
    tip: "Short-term recent voting signal from vote-credit data."
  });

  pills.push({
    ok: Number.isFinite(poolsCount) && poolsCount > 0,
    text:
      Number.isFinite(poolsCount) && poolsCount > 0
        ? `${poolsCount} stake pools delegating`
        : "No stake pool presence",
    tip: "Current pool input."
  });

  let reliabilityNote = "Confidence low – short history.";
  if (n >= 48) reliabilityNote = "Confidence strong – extensive history.";
  else if (n >= 24) reliabilityNote = "Confidence moderate – meaningful history.";
  else if (n >= 8) reliabilityNote = "Confidence improving – limited history.";

  return {
    score,
    label,
    trackingText,
    trackingNote,
    pills,
    formulaLine:
      "Score starts at 100, penalised for: delinquency, commission changes, weaker recent voting consistency, APY disagreement, and no pool presence. " +
      reliabilityNote
  };
}

function renderStability(st) {
  safeSetText(document.getElementById("stability-score"), st.score);
  safeSetText(document.getElementById("stability-label"), st.label);
  safeSetText(document.getElementById("stability-tracking"), st.trackingText);
  safeSetText(document.getElementById("stability-note"), st.trackingNote);
  safeSetText(document.getElementById("stability-formula"), st.formulaLine);

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

  if (window.animateRing) window.animateRing(st.score);
}

// ── MAIN ─────────────────────────────────────────
async function main() {
  const validatorName =
    CURRENT.nameFromUrl ||
    (CURRENT.voteFromUrl ? shortKey(CURRENT.voteKey) : CURRENT.name);

  document.title = `${validatorName} · Validator Dashboard`;

  safeSetText(document.getElementById("validator-name-head"), validatorName);
  safeSetText(document.getElementById("validator-name-badge"), `Viewed: ${validatorName}`);

  const headerVote = document.getElementById("header-vote-key");
  if (headerVote) {
    headerVote.textContent = CURRENT.voteKey
      ? `Vote account: ${CURRENT.voteKey}`
      : "Vote account: mainnet validator";
  }

  const currentContext = document.getElementById("current-context");
  if (currentContext) {
    const isDefault = !CURRENT.voteFromUrl;
    currentContext.textContent = isDefault
      ? "Default profile loaded."
      : "Custom validator loaded from the URL.";
  }

  const shareLink = buildShareUrl();
  const shareInput = document.getElementById("share-url");
  if (shareInput) shareInput.value = shareLink;
  renderSystemSignals(await fetchSystemSignals());

  const copyBtn = document.getElementById("copy-btn");
  const copyBtnDefault = "Copy URL";
  if (copyBtn) {
    copyBtn.onclick = async () => {
      try {
        await navigator.clipboard.writeText(shareLink);
        copyBtn.textContent = "Copied!";
      } catch {
        copyBtn.textContent = "Error";
      }
      setTimeout(() => {
        copyBtn.textContent = copyBtnDefault;
      }, 1500);
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
    jitoBadge.textContent = `Jito: ${jitoText}`;
    jitoBadge.className = `badge ${live.jito === true ? "info" : ""}`.trim();
  }
  renderRuntimeSources(live);

  const history = live.commissionHistory || [];
  const latestCom = history.length ? Number(history[history.length - 1]) : 0;
  safeSetText(
    document.getElementById("commission"),
    `${Number.isFinite(latestCom) ? latestCom.toFixed(0) : 0}%`
  );

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

  if (live.epochConsistencySeries?.length && window.renderEpochChart) {
    window.renderEpochChart(live.epochConsistencySeries);
  }

  let ratings = null;
  try {
    ratings = await fetchRatings(CURRENT.voteKey);
    renderRatings(ratings);
  } catch (e) {
    console.warn("ratings failed:", e);
  }

  renderRecentPerformance(computeRecentPerformance({ live, ratings }));

  const poolsCount = Array.isArray(ratings?.pools?.stake_pools)
    ? ratings.pools.stake_pools.length
    : null;

  const snaps = await loadSnapshotsFromDB(CURRENT.voteKey);
  renderStability(computeStability({ live, ratings, poolsCount, snaps }));
}

main();
