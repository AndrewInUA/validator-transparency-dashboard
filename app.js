/**
 * Validator Transparency Dashboard – app.js
 *
 * Public blocks:
 * - Trust Card
 * - Recent performance (last ~30 epochs)
 * - Profitability
 *
 * Mixed block:
 * - Browser-local tracking refreshed with current public inputs
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

function appendSentence(base, extra) {
  if (!base) return extra;
  if (!extra) return base;
  return `${base} ${extra}`;
}

function getRecentEpochsExplanation(windowCount) {
  if (!Number.isFinite(windowCount) || windowCount <= 0) {
    return "No usable recent epoch-to-epoch observations are available yet.";
  }

  return `Here, “recent epochs” means the latest usable epoch-to-epoch vote-credit observations derived from the validator’s epochCredits returned by getVoteAccounts. The dashboard uses up to the last 30 usable observations, but the current window may be smaller if fewer usable entries are available.`;
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
// UI COPY ADJUSTMENTS FROM JS
// ──────────────────────────────────────────────

function applyStaticCopyClarifications() {
  const votingConsistencyInfo = document.querySelector(
    '.muted .info-dot[data-tip*="Voting consistency is a recent relative signal"]'
  );
  if (votingConsistencyInfo) {
    votingConsistencyInfo.dataset.tip =
      "Voting consistency is a recent relative signal based on epoch-to-epoch vote-credit observations derived from the validator’s epochCredits returned by getVoteAccounts. In this dashboard, “recent epochs” means the latest usable observations from that history, up to the last 30. Each observation is compared with the strongest one inside that same recent window and converted into a 0–100% score. Higher values mean more consistent recent voting inside that observed window.";
  }

  const perfTitleInfo = document.querySelector(
    '.title .info-dot[data-tip*="This section uses public data only"]'
  );
  if (perfTitleInfo) {
    perfTitleInfo.dataset.tip =
      "This section uses public data only. “Recent epochs” here means the latest usable epoch-to-epoch vote-credit observations derived from the validator’s epochCredits returned by Solana getVoteAccounts. The dashboard uses up to the last 30 usable observations. If only a few are available, the result should be treated as a directional signal, not a firm judgement.";
  }

  const localTitleInfo = document.querySelector(
    '.title .info-dot[data-tip*="browser-local snapshots collected on this device"]'
  );
  if (localTitleInfo) {
    localTitleInfo.dataset.tip =
      "This block combines browser-local history with current public inputs. Local snapshots collected on this device are the main source, while current live/public data is used to refresh the latest context. So this is not a purely local-only block and not a universal public validator rating either.";
  }

  const stabilityInfo = document.querySelector(
    "#stability-score"
  )?.closest(".kpi-block")?.querySelector(".info-dot");
  if (stabilityInfo) {
    stabilityInfo.dataset.tip =
      "This score is built mainly from browser-local snapshots stored on this device, then refreshed with current public inputs such as live status, APY context, and pool context. It is a personal tracking aid, not a universal public validator rating.";
  }

  const assessmentInfo = document.querySelector(
    "#stability-label"
  )?.closest(".kpi-block")?.querySelector(".info-dot");
  if (assessmentInfo) {
    assessmentInfo.dataset.tip =
      "Simple label derived from the mixed local-plus-current-public score below. It should be read as a quick personal interpretation, not a definitive validator verdict.";
  }

  const trackingInfo = document.querySelector(
    "#stability-tracking"
  )?.closest(".kpi-block")?.querySelector(".info-dot");
  if (trackingInfo) {
    trackingInfo.dataset.tip =
      "How much browser-local history this device has stored for this validator. More stored history usually makes this mixed assessment more meaningful.";
  }

  const perfCard = document.getElementById("perf-window-value")?.closest(".card");
  if (perfCard) {
    const sub = perfCard.querySelector(".subtext");
    if (sub) {
      sub.textContent =
        "Recent behaviour signals that add context beyond the Trust Card, without duplicating the same indicator. “Recent epochs” here means the latest usable epoch-to-epoch vote-credit observations, up to the last 30.";
    }
  }

  const localCard = document.getElementById("stability-score")?.closest(".card");
  if (localCard) {
    const title = localCard.querySelector(".title");
    if (title) {
      title.innerHTML = `
        Local tracking + current public inputs (this browser only)
        <span
          class="info-dot"
          tabindex="0"
          data-tip="This block combines browser-local history with current public inputs. Local snapshots collected on this device are the main source, while current live/public data is used to refresh the latest context. So this is not a purely local-only block and not a universal public validator rating either."
        >i</span>
      `;
    }

    const sub = localCard.querySelector(".subtext");
    if (sub) {
      sub.textContent =
        "This block combines browser-local tracking history with current public inputs. It is personal to this browser, not shared across devices, and it should not be read as a universal public rating.";
    }

    const sourceLabel = localCard.querySelector(".source-label");
    if (sourceLabel) {
      sourceLabel.textContent = "Source model";
    }

    const chips = localCard.querySelectorAll(".source-row .source-chip");
    if (chips[0]) chips[0].textContent = "Browser localStorage (main history)";
    if (chips[1]) chips[1].textContent = "Current live status input";
    if (chips[2]) chips[2].textContent = "Current APY input";
    if (chips[3]) chips[3].textContent = "Current pool input";
  }

  const footer = document.querySelector(".footer");
  if (footer) {
    footer.innerHTML = `
      <p><strong>Source model.</strong> Public blocks use external data. The lower block combines browser-local history with current public inputs, so it is neither purely public nor purely local-only.</p>
      <p><strong>Methodology.</strong> Voting consistency is a relative score derived from the validator’s recent <code>epochCredits</code> returned by <code>getVoteAccounts</code>. Here, “recent epochs” means the latest usable epoch-to-epoch vote-credit observations from that history, up to the last 30. For each observation, the dashboard looks at how many vote credits were added compared with the previous epoch, then compares that result with the strongest observation inside the same recent window. Those relative values are converted into a 0–100% score. Higher values mean more consistent recent voting inside that observed window.</p>
    `;
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
  const recentEpochsExplanation = getRecentEpochsExplanation(windowCount);

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

    windowText = appendSentence(windowText, recentEpochsExplanation);
    windowText = appendSentence(windowText, reliability.note);
    out.window.sub = windowText;
  }

  if (windowCount >= 4 && Number.isFinite(diff)) {
    if (diff >= 3) {
      out.trend.value = reliability.level === "very_low" || reliability.level === "low"
        ? "Looks stronger"
        : "Improving";
      out.trend.sub = `More recent observations are stronger by ${diff.toFixed(2)} points on average. ${recentEpochsExplanation} ${reliability.note}`;
    } else if (diff <= -3) {
      out.trend.value = reliability.level === "very_low" || reliability.level === "low"
        ? "Looks weaker"
        : "Weaker";
      out.trend.sub = `More recent observations are weaker by ${Math.abs(diff).toFixed(
