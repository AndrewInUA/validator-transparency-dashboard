/**
 * Validator Transparency Dashboard – app.js
 *
 * Public blocks:
 * - Trust Card
 * - Recent performance (last ~30 epochs)
 * - Profitability
 *
 * Separate local block:
 * - Local tracking (this browser only)
 */

const USE_LIVE = true;

const VALIDATOR = {
  name: "AndrewInUA",
  voteKey: "3QPGLackJy5LKctYYoPGmA4P8ncyE197jdxr1zP2ho8K"
};

const HELIUS_RPC =
  "https://mainnet.helius-rpc.com/?api-key=REDACTED";

const JITO_PROXY =
  "https://validator-transparency-dashboard.vercel.app/api/jito";

// ──────────────────────────────────────────────
// URL overrides (?vote=&name=) + #vote=
// ──────────────────────────────────────────────

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
  const voteRaw = getParam("vote");
  const nameRaw = getParam("name");

  const vote = (voteRaw || "").trim();
  const name = (nameRaw || "").trim();

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
  return k.length > 12 ? `${k.slice(0, 4)}…${k.slice(-4)}` : k;
}

// ──────────────────────────────────────────────
// HELPERS
// ──────────────────────────────────────────────

async function fetchJitoStatus(voteKey) {
  if (!JITO_PROXY) return false;

  try {
    const url = `${JITO_PROXY}?vote=${encodeURIComponent(voteKey)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Jito proxy HTTP ${res.status}`);
    const json = await res.json();
    return !!json.jito;
  } catch (err) {
    console.warn("Jito check failed:", err);
    return false;
  }
}

function buildShareUrl() {
  const base = `${window.location.origin}${window.location.pathname}`;
  const isGitHubPages = window.location.hostname.includes("github.io");

  const params = new URLSearchParams();
  params.set("vote", CURRENT.voteKey);
  if (CURRENT.nameFromUrl) params.set("name", CURRENT.nameFromUrl);

  return isGitHubPages ? `${base}#${params.toString()}` : `${base}?${params.toString()}`;
}

function updateShareBox() {
  const input = document.getElementById("share-url");
  if (!input) return;

  const link = buildShareUrl();
  input.value = link;

  const copyBtn = document.getElementById("copy-btn");
  if (copyBtn) {
    copyBtn.onclick = async () => {
      try {
        await navigator.clipboard.writeText(link);
        copyBtn.textContent = "Copied!";
        setTimeout(() => (copyBtn.textContent = "Copy"), 1500);
      } catch (err) {
        console.warn("Clipboard copy failed:", err);
        copyBtn.textContent = "Error";
        setTimeout(() => (copyBtn.textContent = "Copy"), 1500);
      }
    };
  }
}

function fmtPct(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return "—%";
  return `${n.toFixed(2)}%`;
}

function fmtSol(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  return n >= 1000 ? n.toFixed(0) : n.toFixed(2);
}

function average(nums) {
  const a = nums.filter((x) => Number.isFinite(x));
  if (!a.length) return null;
  return a.reduce((s, x) => s + x, 0) / a.length;
}

function stddev(nums) {
  const a = nums.filter((x) => Number.isFinite(x));
  if (a.length < 2) return 0;
  const avg = average(a);
  const variance = a.reduce((s, x) => s + ((x - avg) ** 2), 0) / a.length;
  return Math.sqrt(variance);
}

function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}

function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function appendSentence(base, extra) {
  if (!base) return extra;
  if (!extra) return base;
  return `${base} ${extra}`;
}

function getSampleReliability(windowCount) {
  if (!Number.isFinite(windowCount) || windowCount <= 0) {
    return {
      level: "none",
      note: "No recent usable epoch observations are available yet."
    };
  }

  if (windowCount <= 4) {
    return {
      level: "very_low",
      note: `Very small sample (${windowCount} epochs) – treat this as an early directional signal, not a firm conclusion.`
    };
  }

  if (windowCount <= 8) {
    return {
      level: "low",
      note: `Small sample (${windowCount} epochs) – useful for context, but not strong enough for a confident judgement.`
    };
  }

  if (windowCount <= 15) {
    return {
      level: "medium",
      note: `Moderate sample (${windowCount} epochs) – reasonably useful, but still not the full 30-epoch window.`
    };
  }

  return {
    level: "higher",
    note: `Broader sample (${windowCount} epochs) – more reliable than a short window, though still a simplified summary.`
  };
}

// ──────────────────────────────────────────────
// UI copy adjustments that can be done from JS
// ──────────────────────────────────────────────

function applyStaticCopyClarifications() {
  const perfTitleInfo = document.querySelector(
    '.title .info-dot[data-tip*="public data only"]'
  );
  if (perfTitleInfo) {
    perfTitleInfo.dataset.tip =
      "This section uses public data only. It summarizes recent validator behaviour from Solana RPC and reward context from public APY sources. Reliability depends on how many recent usable epochs are available. A very short window should be treated as a directional signal, not a firm judgement.";
  }

  const localTitleInfo = document.querySelector(
    '.title .info-dot[data-tip*="browser-local snapshots collected on this device"]'
  );
  if (localTitleInfo) {
    localTitleInfo.dataset.tip =
      "This is a browser-local personal tracking block. It stores snapshots on this device and builds a private score for this browser only. It is not a universal public validator rating.";
  }

  const stabilityInfo = document.querySelector(
    '#stability-score'
  )?.closest('.kpi-block')?.querySelector('.info-dot');
  if (stabilityInfo) {
    stabilityInfo.dataset.tip =
      "Browser-local score built mainly from snapshots stored on this device, with current live/public inputs used only to refresh the latest view. It is a personal tracking aid, not a universal public rating.";
  }

  const assessmentInfo = document.querySelector(
    '#stability-label'
  )?.closest('.kpi-block')?.querySelector('.info-dot');
  if (assessmentInfo) {
    assessmentInfo.dataset.tip =
      "Simple browser-local label derived from the local tracking score. It should be read as a quick personal interpretation, not a definitive validator verdict.";
  }

  const trackingInfo = document.querySelector(
    '#stability-tracking'
  )?.closest('.kpi-block')?.querySelector('.info-dot');
  if (trackingInfo) {
    trackingInfo.dataset.tip =
      "How much history this browser has stored for this validator. More local history usually makes the browser-local assessment more meaningful.";
  }

  const localCard = document.getElementById("stability-score")?.closest(".card");
  if (localCard) {
    const sub = localCard.querySelector(".subtext");
    if (sub) {
      sub.textContent =
        "Personal tracking built from visits in this browser. Not shared across devices. The score and assessment below are browser-local interpretations, not universal public ratings.";
    }

    const sourceLabel = localCard.querySelector(".source-label");
    if (sourceLabel) {
      sourceLabel.textContent = "Source model";
    }

    const chips = localCard.querySelectorAll(".source-row .source-chip");
    if (chips[0]) chips[0].textContent = "Browser localStorage (main source)";
    if (chips[1]) chips[1].textContent = "Current live status refresh";
    if (chips[2]) chips[2].textContent = "Current APY context refresh";
    if (chips[3]) chips[3].textContent = "Current pool context refresh";
  }
}

// ──────────────────────────────────────────────
// Ratings API
// ──────────────────────────────────────────────

async function fetchRatings(voteKey) {
  const url = `/api/ratings?vote=${encodeURIComponent(voteKey)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`/api/ratings -> HTTP ${res.status}`);
  return res.json();
}

function pickTrilliumApy(trilliumObj) {
  if (!trilliumObj) return null;
  const candidates = [
    trilliumObj.average_delegator_total_apy,
    trilliumObj.delegator_total_apy,
    trilliumObj.total_overall_apy
  ];
  for (const c of candidates) {
    const n = Number(c);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function renderRatings(r) {
  const elMedian = document.getElementById("apy-median");
  const elStakewiz = document.getElementById("apy-stakewiz");
  const elTrillium = document.getElementById("apy-trillium");
  const elPoolsCount = document.getElementById("pools-count");
  const elPoolsTotals = document.getElementById("pools-totals");
  const elPoolsList = document.getElementById("pools-list");
  const elSourcesNote = document.getElementById("apy-sources-note");

  if (elMedian) elMedian.textContent = fmtPct(r?.derived?.apy_median);
  if (elStakewiz) elStakewiz.textContent = fmtPct(r?.sources?.stakewiz?.total_apy);

  const trilliumObj = r?.sources?.trillium;
  const trilliumApy = pickTrilliumApy(trilliumObj);
  if (elTrillium) elTrillium.textContent = fmtPct(trilliumApy);

  const pools = Array.isArray(r?.pools?.stake_pools) ? r.pools.stake_pools : [];
  if (elPoolsCount) elPoolsCount.textContent = pools.length ? String(pools.length) : "—";

  if (elPoolsTotals) {
    const a = fmtSol(r?.pools?.total_from_stake_pools);
    const b = fmtSol(r?.pools?.total_not_from_stake_pools);
    elPoolsTotals.textContent = `Stake from pools: ${a} SOL • Not from pools: ${b} SOL`;
  }

  if (elPoolsList) {
    elPoolsList.innerHTML = "";
    const top = pools.slice(0, 12);

    if (!top.length) {
      const empty = document.createElement("div");
      empty.className = "muted small";
      empty.textContent = "No stake pool data available right now.";
      elPoolsList.appendChild(empty);
    } else {
      for (const p of top) {
        const b = document.createElement("span");
        b.className = "pool-badge";
        b.textContent = `${p.name}: ${fmtSol(p.sol)} SOL`;
        elPoolsList.appendChild(b);
      }
      if (pools.length > top.length) {
        const more = document.createElement("span");
        more.className = "pool-badge";
        more.textContent = `+${pools.length - top.length} more`;
        elPoolsList.appendChild(more);
      }
    }
  }

  if (elSourcesNote) {
    const sw = r?.sources?.stakewiz;
    const trOk = trilliumObj && !trilliumObj?.error && trilliumApy !== null;

    let text = "Public API status: ";

    if (!sw || sw.error) {
      const err = (sw?.error || "").toLowerCase();
      text += err.includes("timeout") ? "Stakewiz timeout. " : "Stakewiz unavailable. ";
    } else {
      text += "Stakewiz OK. ";
    }

    text += trOk ? "Trillium OK." : "Trillium unavailable.";
    elSourcesNote.textContent = text;
  }
}

// ──────────────────────────────────────────────
// LIVE DATA: Solana JSON-RPC
// ──────────────────────────────────────────────

async function fetchLive(voteKey) {
  const RPCS = [
    HELIUS_RPC,
    "https://api.mainnet-beta.solana.com",
    "https://rpc.ankr.com/solana"
  ];

  const requestBody = {
    jsonrpc: "2.0",
    id: 1,
    method: "getVoteAccounts",
    params: [{ commitment: "finalized" }]
  };

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
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify(requestBody)
      });

      if (!res.ok) throw new Error(`RPC ${rpc} → HTTP ${res.status}`);

      const json = await res.json();
      const current = json?.result?.current || [];
      const delinquent = json?.result?.delinquent || [];
      const all = current.concat(delinquent);

      const me = all.find((v) => v.votePubkey === voteKey);
      if (!me) return { ...EMPTY, status: "not found" };

      const commission = Number(me.commission ?? 0);
      const isDelinquent = delinquent.some((v) => v.votePubkey === me.votePubkey);
      const status = isDelinquent ? "delinquent" : "healthy";

      let uptimePct = 0;
      let epochConsistencySeries = [];

      try {
        const credits = Array.isArray(me.epochCredits) ? me.epochCredits : [];
        const deltas = [];

        for (let i = 1; i < credits.length; i++) {
          const prevCredits = credits[i - 1]?.[1] ?? 0;
          const curCredits = credits[i]?.[1] ?? 0;
          deltas.push(Math.max(0, curCredits - prevCredits));
        }

        const recentDeltas = deltas.slice(-30);
        if (recentDeltas.length) {
          const maxDelta = Math.max(...recentDeltas, 1);
          epochConsistencySeries = recentDeltas.map((d) =>
            Math.round(((d / maxDelta) * 100) * 100) / 100
          );
        }

        const last5 = epochConsistencySeries.slice(-5);
        uptimePct = last5.length
          ? Math.round((last5.reduce((s, x) => s + x, 0) / last5.length) * 100) / 100
          : 0;
      } catch (err) {
        console.warn("Failed to build epoch consistency series:", err);
        uptimePct = 0;
        epochConsistencySeries = [];
      }

      const jito = await fetchJitoStatus(voteKey);

      return {
        commissionHistory: Array(10).fill(commission),
        uptimeLast5EpochsPct: uptimePct,
        jito,
        status,
        votePubkey: me.votePubkey,
        nodePubkey: me.nodePubkey || null,
        epochCreditsLen: Array.isArray(me.epochCredits) ? me.epochCredits.length : 0,
        epochConsistencySeries
      };
    } catch (err) {
      console.warn("RPC failed:", rpc, err.message || err);
    }
  }

  return EMPTY;
}

// ──────────────────────────────────────────────
// PUBLIC RECENT PERFORMANCE
// ──────────────────────────────────────────────

function computeRecentPerformance({ live, ratings }) {
  const series = Array.isArray(live?.epochConsistencySeries)
    ? live.epochConsistencySeries.filter((x) => Number.isFinite(x))
    : [];

  const windowCount = series.length;
  const avg = average(series);
  const volatility = stddev(series);

  const mid = Math.floor(windowCount / 2);
  const firstHalf = series.slice(0, mid);
  const secondHalf = series.slice(mid);

  const firstAvg = average(firstHalf);
  const secondAvg = average(secondHalf);
  const diff =
    Number.isFinite(firstAvg) && Number.isFinite(secondAvg)
      ? secondAvg - firstAvg
      : null;

  const reliability = getSampleReliability(windowCount);

  const apyMedian = Number(ratings?.derived?.apy_median);
  const sw = Number(ratings?.sources?.stakewiz?.total_apy);
  const tr = pickTrilliumApy(ratings?.sources?.trillium);
  const jito = !!live?.jito;

  const out = {
    window: {
      value: "—",
      sub: "Recent epoch window is not available yet."
    },
    trend: {
      value: "—",
      sub: "Not enough recent epoch observations for a trend yet."
    },
    variability: {
      value: "—",
      sub: "Not enough recent epoch observations for a variability read yet."
    },
    reward: {
      value: jito ? "Jito enabled" : "Jito not detected",
      sub: "Reward context based on public APY sources."
    }
  };

  if (windowCount > 0) {
    out.window.value = `${windowCount} epochs`;

    let windowText =
      `Using ${windowCount} recent usable epoch-to-epoch observations from Solana RPC (maximum shown here: 30).`;

    if (Number.isFinite(avg)) {
      windowText = appendSentence(
        windowText,
        `Average relative voting consistency in this window: ${avg.toFixed(2)}%.`
      );
    }

    windowText = appendSentence(windowText, reliability.note);
    out.window.sub = windowText;
  }

  if (windowCount >= 4 && Number.isFinite(diff)) {
    if (diff >= 3) {
      out.trend.value = reliability.level === "very_low" || reliability.level === "low"
        ? "Looks stronger"
        : "Improving";
      out.trend.sub = `More recent epochs are stronger by ${diff.toFixed(2)} points on average. ${reliability.note}`;
    } else if (diff <= -3) {
      out.trend.value = reliability.level === "very_low" || reliability.level === "low"
        ? "Looks weaker"
        : "Weaker";
      out.trend.sub = `More recent epochs are weaker by ${Math.abs(diff).toFixed(2)} points on average. ${reliability.note}`;
    } else {
      out.trend.value = "Stable";
      out.trend.sub = `Recent epoch performance looks broadly stable. ${reliability.note}`;
    }
  } else if (windowCount > 0) {
    out.trend.value = "Limited data";
    out.trend.sub = `Only ${windowCount} recent usable epochs are available, so the trend read is still limited. ${reliability.note}`;
  }

  if (windowCount >= 2 && Number.isFinite(volatility)) {
    if (volatility <= 5) {
      out.variability.value = reliability.level === "very_low" ? "Possibly low" : "Low";
      out.variability.sub = `Recent voting performance looks steady (variability ${volatility.toFixed(2)}). ${reliability.note}`;
    } else if (volatility <= 12) {
      out.variability.value = reliability.level === "very_low" ? "Possibly moderate" : "Moderate";
      out.variability.sub = `Recent voting performance shows some variation (variability ${volatility.toFixed(2)}). ${reliability.note}`;
    } else {
      out.variability.value = reliability.level === "very_low" || reliability.level === "low"
        ? "Possibly high"
        : "High";
      out.variability.sub = `Recent voting performance is uneven (variability ${volatility.toFixed(2)}). ${reliability.note}`;
    }
  } else if (windowCount === 1) {
    out.variability.value = "Limited data";
    out.variability.sub = `Only one recent usable epoch is available, so variability cannot be assessed yet. ${reliability.note}`;
  }

  const rewardParts = [];
  rewardParts.push(
    jito
      ? "Additional rewards via Jito appear enabled."
      : "No Jito signal detected right now."
  );

  if (Number.isFinite(apyMedian)) {
    rewardParts.push(`Median APY: ${apyMedian.toFixed(2)}%.`);
  }

  if (Number.isFinite(sw) && Number.isFinite(tr)) {
    const delta = Math.abs(sw - tr);
    rewardParts.push(
      delta <= 1
        ? "APY sources are closely aligned."
        : `APY sources differ by ${delta.toFixed(2)} points.`
    );
  } else if (Number.isFinite(sw) || Number.isFinite(tr)) {
    rewardParts.push("One public APY source is available right now.");
  } else {
    rewardParts.push("Public APY data unavailable right now.");
  }

  rewardParts.push("Reward context is broader than the epoch window, but it is still a simplified summary.");
  out.reward.sub = rewardParts.join(" ");

  return out;
}

function renderRecentPerformance(perf) {
  const windowValue = document.getElementById("perf-window-value");
  const windowSub = document.getElementById("perf-window-sub");
  const trendValue = document.getElementById("perf-trend-value");
  const trendSub = document.getElementById("perf-trend-sub");
  const varValue = document.getElementById("perf-var-value");
  const varSub = document.getElementById("perf-var-sub");
  const rewardValue = document.getElementById("perf-reward-value");
  const rewardSub = document.getElementById("perf-reward-sub");

  if (windowValue) windowValue.textContent = perf.window.value;
  if (windowSub) windowSub.textContent = perf.window.sub;

  if (trendValue) trendValue.textContent = perf.trend.value;
  if (trendSub) trendSub.textContent = perf.trend.sub;

  if (varValue) varValue.textContent = perf.variability.value;
  if (varSub) varSub.textContent = perf.variability.sub;

  if (rewardValue) rewardValue.textContent = perf.reward.value;
  if (rewardSub) rewardSub.textContent = perf.reward.sub;
}

// ──────────────────────────────────────────────
// LOCAL SNAPSHOTS FOR LOCAL TRACKING ONLY
// ──────────────────────────────────────────────

function safeJsonParse(s) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function lsKeyForVote(voteKey) {
  return `vtd_snapshots_${voteKey}`;
}

function loadSnapshots(voteKey) {
  try {
    const raw = localStorage.getItem(lsKeyForVote(voteKey));
    const arr = safeJsonParse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function saveSnapshots(voteKey, snaps) {
  try {
    localStorage.setItem(lsKeyForVote(voteKey), JSON.stringify(snaps));
  } catch {}
}

function pushSnapshotIfNeeded(voteKey, snap) {
  const snaps = loadSnapshots(voteKey);
  const last = snaps.length ? snaps[snaps.length - 1] : null;

  if (last && Number.isFinite(last.t) && (snap.t - last.t) < 30 * 60 * 1000) {
    return snaps;
  }

  snaps.push(snap);
  const trimmed = snaps.slice(-120);
  saveSnapshots(voteKey, trimmed);
  return trimmed;
}

// ──────────────────────────────────────────────
// LOCAL TRACKING
// ──────────────────────────────────────────────

function computeStability({ live, ratings, poolsCount }) {
  const snaps = loadSnapshots(CURRENT.voteKey);
  const n = snaps.length;

  const nowStatus = live?.status || "—";
  const nowUptime = Number(live?.uptimeLast5EpochsPct || 0);

  const sw = Number(ratings?.sources?.stakewiz?.total_apy);
  const tr = pickTrilliumApy(ratings?.sources?.trillium);
  const apyDiff =
    Number.isFinite(sw) && Number.isFinite(tr) ? Math.abs(sw - tr) : null;

  let delinquentCount = 0;
  let commissionChanges = 0;

  for (let i = 0; i < snaps.length; i++) {
    if (snaps[i]?.status && snaps[i].status !== "healthy") delinquentCount++;
    if (
      i > 0 &&
      Number.isFinite(snaps[i].commission) &&
      Number.isFinite(snaps[i - 1].commission)
    ) {
      if (snaps[i].commission !== snaps[i - 1].commission) commissionChanges++;
    }
  }

  const delinquentRate = n ? delinquentCount / n : 0;

  let score = 100;
  if (nowStatus === "delinquent") score -= 40;
  score -= delinquentRate * 40;
  score -= clamp(commissionChanges * 5, 0, 20);

  if (Number.isFinite(nowUptime) && nowUptime < 95) {
    score -= clamp((95 - nowUptime) * 1.5, 0, 20);
  }

  if (apyDiff !== null && apyDiff > 1) {
    score -= clamp((apyDiff - 1) * 5, 0, 15);
  }

  if (!Number.isFinite(poolsCount) || poolsCount <= 0) score -= 10;
  score = clamp(Math.round(score), 0, 100);

  let label = "—";
  if (score >= 85) label = "Strong";
  else if (score >= 70) label = "Good";
  else if (score >= 50) label = "Watch";
  else label = "Risk";

  let trackingText = "Today";
  let trackingNote =
    "Tracking starts building from this browser. A short local history makes the local assessment less reliable.";

  if (n >= 2) {
    const t0 = snaps[0].t;
    const t1 = snaps[n - 1].t;
    const days = Math.max(0, (t1 - t0) / (24 * 3600 * 1000));
    const daysNice =
      days >= 1
        ? `${days.toFixed(0)}d`
        : `${Math.max(1, (days * 24).toFixed(0))}h`;
    trackingText = `${daysNice}`;
    trackingNote = `${n} snapshots stored in this browser. This is still a browser-local interpretation, not a universal public validator rating.`;
  }

  const pills = [];

  if (n >= 2) {
    pills.push({
      ok: delinquentCount === 0,
      text:
        delinquentCount === 0
          ? "No delinquency observed locally"
          : `Delinquency seen locally (${delinquentCount}/${n})`,
      tip: "Based on snapshots stored in this browser."
    });
  } else {
    pills.push({
      ok: nowStatus === "healthy",
      text: nowStatus === "healthy" ? "Healthy now" : `Status: ${nowStatus}`,
      tip: "Current live status."
    });
  }

  if (n >= 2) {
    pills.push({
      ok: commissionChanges === 0,
      text:
        commissionChanges === 0
          ? "Commission stable locally"
          : `Commission changed locally (${commissionChanges})`,
      tip: "Based on local browser snapshots."
    });
  } else {
    pills.push({
      ok: true,
      text: "Commission tracking builds locally",
      tip: "Needs more browser snapshots."
    });
  }

  if (apyDiff === null) {
    pills.push({
      ok: false,
      text: "APY agreement unavailable",
      tip: "Needs available APY data from Stakewiz and Trillium."
    });
  } else if (apyDiff <= 0.75) {
    pills.push({
      ok: true,
      text: `APY sources aligned (Δ ${apyDiff.toFixed(2)}%)`,
      tip: "Smaller Δ means closer agreement."
    });
  } else if (apyDiff <= 1.5) {
    pills.push({
      ok: true,
      text: `APY sources close (Δ ${apyDiff.toFixed(2)}%)`,
      tip: "Moderate difference between APY sources."
    });
  } else {
    pills.push({
      ok: false,
      text: `APY disagreement (Δ ${apyDiff.toFixed(2)}%)`,
      tip: "Large difference between APY sources."
    });
  }

  let vcText = "Voting consistency unavailable";
  let vcOk = false;
  if (Number.isFinite(nowUptime)) {
    if (nowUptime >= 95) {
      vcText = `Recent voting consistency: strong (${nowUptime.toFixed(2)}%)`;
      vcOk = true;
    } else if (nowUptime >= 90) {
      vcText = `Recent voting consistency: good (${nowUptime.toFixed(2)}%)`;
      vcOk = true;
    } else {
      vcText = `Recent voting consistency: needs attention (${nowUptime.toFixed(2)}%)`;
    }
  }
  pills.push({
    ok: vcOk,
    text: vcText,
    tip: "Current recent voting consistency signal used inside the local score."
  });

  pills.push({
    ok: Number.isFinite(poolsCount) && poolsCount > 0,
    text:
      Number.isFinite(poolsCount) && poolsCount > 0
        ? `Stake pool presence (${poolsCount})`
        : "No stake pool presence",
    tip: "Current pool context from public data, used only as one input into the browser-local score."
  });

  let localReliabilityNote = "Reliability of this browser-local assessment is still low because the local history is short.";
  if (n >= 48) {
    localReliabilityNote = "Reliability of this browser-local assessment is stronger because this browser has accumulated a longer local history.";
  } else if (n >= 24) {
    localReliabilityNote = "Reliability of this browser-local assessment is moderate because this browser has accumulated a meaningful local history.";
  } else if (n >= 8) {
    localReliabilityNote = "Reliability of this browser-local assessment is improving, but it still depends on a limited local history.";
  }

  const formulaLine =
    "This browser-local score starts at 100 and applies penalties for delinquency, commission changes seen locally, lower recent voting consistency, APY disagreement, and missing pool presence. " +
    localReliabilityNote;

  return { score, label, trackingText, trackingNote, pills, formulaLine };
}

function renderStability(st) {
  const elScore = document.getElementById("stability-score");
  const elLabel = document.getElementById("stability-label");
  const elTracking = document.getElementById("stability-tracking");
  const elPills = document.getElementById("stability-pills");
  const elNote = document.getElementById("stability-note");
  const elFormula = document.getElementById("stability-formula");

  if (elScore) elScore.textContent = `${st.score}/100`;
  if (elLabel) elLabel.textContent = st.label;
  if (elTracking) elTracking.textContent = st.trackingText;

  if (elPills) {
    elPills.innerHTML = "";
    for (const p of st.pills) {
      const span = document.createElement("span");
      span.className = `pill ${p.ok ? "pill-ok" : "pill-warn"}`;
      span.textContent = p.text;
      if (p.tip) span.title = p.tip;
      elPills.appendChild(span);
    }
  }

  if (elNote) elNote.textContent = st.trackingNote;
  if (elFormula) elFormula.textContent = st.formulaLine;
}

// ──────────────────────────────────────────────
// MAIN
// ──────────────────────────────────────────────

async function main() {
  applyStaticCopyClarifications();

  const nameEl = document.getElementById("validator-name");
  if (nameEl) {
    const label = CURRENT.nameFromUrl
      ? CURRENT.nameFromUrl
      : `vote ${shortKey(CURRENT.voteKey)}`;
    nameEl.textContent = `Validator: ${label}`;
  }

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
          epochConsistencySeries: [99, 98, 100, 97, 99, 98, 100, 99]
        };
  } catch (err) {
    console.error("Fatal error in fetchLive:", err);
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

  if (nameEl) {
    const finalLabel = CURRENT.nameFromUrl
      ? CURRENT.nameFromUrl
      : live.nodePubkey
        ? `node ${shortKey(live.nodePubkey)}`
        : `vote ${shortKey(CURRENT.voteKey)}`;
    nameEl.textContent = `Validator: ${finalLabel}`;
  }

  const jitoBadge = document.getElementById("jito-badge");
  if (jitoBadge) {
    jitoBadge.textContent = `Jito: ${live.jito ? "ON" : "OFF"}`;
    jitoBadge.classList.remove("ok", "warn");
    jitoBadge.classList.add(live.jito ? "ok" : "warn");
  }

  const history = live.commissionHistory || [];
  const latestCommission = history.length ? Number(history[history.length - 1]) : 0;

  const commissionEl = document.getElementById("commission");
  if (commissionEl) {
    commissionEl.textContent = `${Number.isFinite(latestCommission) ? latestCommission.toFixed(0) : 0}%`;
  }

  const uptimeEl = document.getElementById("uptime");
  if (uptimeEl) {
    uptimeEl.textContent = `${Number(live.uptimeLast5EpochsPct || 0).toFixed(2)}%`;
  }

  const statusEl = document.getElementById("status");
  if (statusEl) {
    const statusText =
      live.status === "healthy"
        ? "healthy"
        : live.status === "delinquent"
          ? "delinquent"
          : live.status || "—";

    statusEl.textContent = statusText;
    statusEl.classList.remove("ok", "warn");

    if (live.status === "healthy") {
      statusEl.classList.add("ok");
    } else {
      statusEl.classList.add("warn");
    }
  }

  const tsEl = document.getElementById("last-updated");
  if (tsEl) {
    const ts = new Date();
    const fmt = ts.toLocaleString("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      day: "2-digit",
      month: "short"
    });
    tsEl.textContent = `Last updated: ${fmt}`;
  }

  updateShareBox();

  let ratings = null;
  try {
    ratings = await fetchRatings(CURRENT.voteKey);
    renderRatings(ratings);
  } catch (e) {
    console.warn("ratings fetch failed:", e);
  }

  const perf = computeRecentPerformance({ live, ratings });
  renderRecentPerformance(perf);

  const poolsCount = Array.isArray(ratings?.pools?.stake_pools)
    ? ratings.pools.stake_pools.length
    : null;

  const sw = Number(ratings?.sources?.stakewiz?.total_apy);
  const tr = pickTrilliumApy(ratings?.sources?.trillium);

  const snap = {
    t: Date.now(),
    status: live.status || null,
    commission: Number.isFinite(latestCommission) ? latestCommission : null,
    uptime: Number.isFinite(Number(live.uptimeLast5EpochsPct))
      ? Number(live.uptimeLast5EpochsPct)
      : null,
    sw_apy: Number.isFinite(sw) ? sw : null,
    tr_apy: Number.isFinite(tr) ? tr : null,
    pools: Number.isFinite(poolsCount) ? poolsCount : null
  };
  pushSnapshotIfNeeded(CURRENT.voteKey, snap);

  const st = computeStability({ live, ratings, poolsCount });
  renderStability(st);
}

main();
