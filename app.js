/**
 * Validator Transparency Dashboard – app.js v35
 * Backend-only snapshot model:
 * page open -> /api/track-validator -> tracked_validators
 * CRON -> /api/collect -> Supabase -> frontend reads only
 */

const USE_LIVE = true;

const VALIDATOR = {
  name: "AndrewInUA",
  voteKey: "3QPGLackJy5LKctYYoPGmA4P8ncyE197jdxr1zP2ho8K"
};

const HELIUS_RPC =
  "https://mainnet.helius-rpc.com/?api-key=REDACTED";

const JITO_PROXY = "/api/jito";
const SNAPSHOTS_API = "/api/snapshots";
const TRACK_VALIDATOR_API = "/api/track-validator";

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
  if (!k) return "—";
  return k.length > 12 ? `${k.slice(0, 6)}…${k.slice(-6)}` : k;
}

function fmtPct(v) {
  const n = Number(v);
  return Number.isFinite(n) ? `${n.toFixed(2)}%` : "—%";
}

function fmtSol(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
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

function getSampleReliability(n) {
  if (!Number.isFinite(n) || n <= 0) {
    return { level: "none", note: "No recent data yet." };
  }
  if (n <= 4) return { level: "very_low", note: `Limited data (${n} epochs).` };
  if (n <= 8) return { level: "low", note: `Limited: ${n} epochs.` };
  if (n <= 15) return { level: "medium", note: `${n} epochs observed.` };
  return { level: "higher", note: `${n} epochs observed.` };
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
    return !!json?.jito;
  } catch {
    return false;
  }
}

// ── RATINGS ──────────────────────────────────────
async function fetchRatings(voteKey) {
  const res = await fetch(`/api/ratings?vote=${encodeURIComponent(voteKey)}`);
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
    pools.length ? String(pools.length) : "—"
  );
  safeSetText(
    document.getElementById("pools-count-kpi"),
    pools.length ? String(pools.length) : "—"
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
  const RPCS = [
    HELIUS_RPC,
    "https://api.mainnet-beta.solana.com",
    "https://rpc.ankr.com/solana"
  ];

  const body = JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "getVoteAccounts",
    params: [{ commitment: "finalized" }]
  });

  const EMPTY = {
    commissionHistory: Array(10).fill(0),
    uptimeLast5EpochsPct: 0,
    jito: false,
    status: "error",
    votePubkey: null,
    nodePubkey: null,
    epochCreditsLen: 0,
    epochConsistencySeries: []
  };

  for (const rpc of RPCS) {
    try {
      const res = await fetch(rpc, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const json = await res.json();
      const current = json?.result?.current || [];
      const delinquent = json?.result?.delinquent || [];
      const me = [...current, ...delinquent].find(v => v.votePubkey === voteKey);

      if (!me) return { ...EMPTY, status: "not found" };

      const commission = Number(me.commission ?? 0);
      const isDelinquent = delinquent.some(v => v.votePubkey === me.votePubkey);

      let uptimePct = 0;
      let epochConsistencySeries = [];

      try {
        const credits = Array.isArray(me.epochCredits) ? me.epochCredits : [];
        const deltas = [];

        for (let i = 1; i < credits.length; i++) {
          deltas.push(
            Math.max(0, (credits[i]?.[1] ?? 0) - (credits[i - 1]?.[1] ?? 0))
          );
        }

        const recent = deltas.slice(-30);

        if (recent.length) {
          const maxD = Math.max(...recent, 1);
          epochConsistencySeries = recent.map(
            d => Math.round((d / maxD) * 10000) / 100
          );
        }

        const last5 = epochConsistencySeries.slice(-5);
        uptimePct = last5.length
          ? Math.round(
              (last5.reduce((s, x) => s + x, 0) / last5.length) * 100
            ) / 100
          : 0;
      } catch (e) {
        console.warn("epoch calc:", e);
      }

      const jito = await fetchJitoStatus(voteKey);

      return {
        commissionHistory: Array(10).fill(commission),
        uptimeLast5EpochsPct: uptimePct,
        jito,
        status: isDelinquent ? "delinquent" : "healthy",
        votePubkey: me.votePubkey,
        nodePubkey: me.nodePubkey || null,
        epochCreditsLen: Array.isArray(me.epochCredits) ? me.epochCredits.length : 0,
        epochConsistencySeries
      };
    } catch (err) {
      console.warn("RPC failed:", rpc, err.message);
    }
  }

  return EMPTY;
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
  const jito = !!live?.jito;
  const apyMedian = Number(ratings?.derived?.apy_median);
  const sw = Number(ratings?.sources?.stakewiz?.total_apy);
  const tr = pickTrilliumApy(ratings?.sources?.trillium);

  const out = {
    window: { value: "—", sub: "No data yet." },
    trend: { value: "—", sub: "Not enough data." },
    variability: { value: "—", sub: "Not enough data." },
    reward: { value: jito ? "Jito ON" : "Jito OFF", sub: "—" }
  };

  if (n > 0) {
    out.window.value = `${n} epochs`;
    out.window.sub = `Up to 30. ${rel.note}`;
  }

  if (n >= 4 && Number.isFinite(diff)) {
    const s = simplifyTrendDelta(diff);
    const cap = s ? s[0].toUpperCase() + s.slice(1) : "";

    if (diff >= 3) {
      out.trend.value = "Improving";
      out.trend.sub = `${cap} improvement recently.`.trim();
    } else if (diff <= -3) {
      out.trend.value = "Declining";
      out.trend.sub = `${cap} decline recently.`.trim();
    } else {
      out.trend.value = "Stable";
      out.trend.sub = "No clear recent change.";
    }

    if (rel.level === "very_low" || rel.level === "low") {
      out.trend.value = "Limited data";
      out.trend.sub = rel.note;
    }
  } else if (n > 0) {
    out.trend.value = "Limited";
    out.trend.sub = rel.note;
  }

  if (n >= 2 && Number.isFinite(volatility)) {
    if (volatility <= 5) {
      out.variability.value = "Low";
      out.variability.sub = "Performance looks steady.";
    } else if (volatility <= 12) {
      out.variability.value = "Moderate";
      out.variability.sub = "Some fluctuation, not unstable.";
    } else {
      out.variability.value = "High";
      out.variability.sub = "Uneven recent performance.";
    }

    if (rel.level === "very_low") {
      out.variability.sub += " " + rel.note;
    }
  }

  const rp = [
    jito ? "Jito enabled – extra rewards active." : "No Jito rewards detected."
  ];

  if (Number.isFinite(apyMedian)) rp.push(`Median APY: ${apyMedian.toFixed(2)}%.`);

  rp.push(
    Number.isFinite(sw) && Number.isFinite(tr)
      ? Math.abs(sw - tr) <= 1
        ? "APY sources match closely."
        : "APY sources differ."
      : "Limited APY data."
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
  const nowStatus = live?.status || "—";
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
      ? "Voting data unavailable"
      : nowUptime >= 95
        ? `Voting strong (${nowUptime.toFixed(1)}%)`
        : nowUptime >= 90
          ? `Voting good (${nowUptime.toFixed(1)}%)`
          : `Voting needs attention (${nowUptime.toFixed(1)}%)`,
    tip: "Current voting reliability."
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
      "Score starts at 100, penalised for: delinquency, commission changes, low voting, APY disagreement, and no pool presence. " +
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
  const validatorName = CURRENT.nameFromUrl || CURRENT.name;

  document.title = `${validatorName} · Validator Dashboard`;

  safeSetText(document.getElementById("page-title"), validatorName);
  safeSetText(document.getElementById("validator-name-head"), validatorName);
  safeSetText(document.getElementById("validator-name-badge"), validatorName);
  safeSetText(
    document.getElementById("header-sub"),
    `Solana validator transparency dashboard · ${shortKey(CURRENT.voteKey)}`
  );

  const headerVote = document.getElementById("header-vote-key");
  if (headerVote) {
    headerVote.textContent = CURRENT.voteKey
      ? `${CURRENT.voteKey.slice(0, 8)}…${CURRENT.voteKey.slice(-8)}`
      : "mainnet validator";
  }

  const avatar = document.getElementById("id-avatar");
  if (avatar) avatar.textContent = validatorName.slice(0, 2).toUpperCase();

  safeSetText(document.getElementById("id-name"), validatorName);
  safeSetText(document.getElementById("id-votekey"), CURRENT.voteKey);

  const shareLink = buildShareUrl();
  const shareInput = document.getElementById("share-url");
  if (shareInput) shareInput.value = shareLink;

  const copyBtn = document.getElementById("copy-btn");
  if (copyBtn) {
    copyBtn.onclick = async () => {
      try {
        await navigator.clipboard.writeText(shareLink);
        copyBtn.textContent = "Copied!";
      } catch {
        copyBtn.textContent = "Error";
      }
      setTimeout(() => {
        copyBtn.textContent = "COPY";
      }, 1500);
    };
  }

  // Non-blocking: opening a validator page should register it for backend tracking.
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

  safeSetText(document.getElementById("node-key"), live.nodePubkey || "Not available");

  const statusVal = live.status || "—";
  const statusEl = document.getElementById("status");
  if (statusEl) {
    statusEl.textContent =
      statusVal.charAt(0).toUpperCase() + statusVal.slice(1);
    statusEl.className = `status-big ${statusVal === "healthy" ? "ok" : "warn"}`;
  }

  const jitoBadge = document.getElementById("jito-badge");
  if (jitoBadge) {
    jitoBadge.textContent = `Jito: ${live.jito ? "ON" : "OFF"}`;
    jitoBadge.className = `badge ${live.jito ? "info" : ""}`.trim();
  }

  const history = live.commissionHistory || [];
  const latestCom = history.length ? Number(history[history.length - 1]) : 0;
  safeSetText(
    document.getElementById("commission"),
    `${Number.isFinite(latestCom) ? latestCom.toFixed(0) : 0}%`
  );

  const uptimeNum = Number(live.uptimeLast5EpochsPct);
  safeSetText(
    document.getElementById("uptime"),
    Number.isFinite(uptimeNum) ? `${uptimeNum.toFixed(1)}%` : "—%"
  );

  const ts = new Date().toLocaleString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    day: "2-digit",
    month: "short"
  });

  safeSetText(document.getElementById("last-updated"), `Last updated: ${ts}`);
  safeSetText(
    document.getElementById("last-updated-card"),
    `Last updated: ${ts}`
  );

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
