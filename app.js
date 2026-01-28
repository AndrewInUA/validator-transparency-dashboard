/**
 * Validator Transparency Dashboard – app.js
 *
 * Adds: Validator stability block (local tracking via localStorage)
 */

const USE_LIVE = true;

const VALIDATOR = {
  name: "AndrewInUA",
  voteKey: "3QPGLackJy5LKctYYoPGmA4P8ncyE197jdxr1zP2ho8K"
};

const HELIUS_RPC =
  "https://mainnet.helius-rpc.com/?api-key=8c0db429-5430-4151-95f3-7487584d0a36";

const JITO_PROXY =
  "https://validator-transparency-dashboard.vercel.app/api/jito";

// ──────────────────────────────────────────────
// URL overrides (?vote=&name=) + #vote= (GitHub Pages)
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

function drawSpark(canvas, values) {
  const ctx = canvas.getContext("2d");
  const w = canvas.width;
  const h = canvas.height;

  ctx.clearRect(0, 0, w, h);

  const min = Math.min(...values);
  const max = Math.max(...values);
  const pad = 4;

  ctx.beginPath();

  values.forEach((v, i) => {
    const x = pad + (i * (w - 2 * pad)) / (values.length - 1);
    const y = h - pad - ((v - min) / ((max - min) || 1)) * (h - 2 * pad);

    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });

  ctx.lineWidth = 2;
  ctx.strokeStyle = "#8bd5ff";
  ctx.stroke();
}

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

async function fetchRatings(voteKey) {
  const url = `/api/ratings?vote=${encodeURIComponent(voteKey)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`/api/ratings -> HTTP ${res.status}`);
  return res.json();
}

function pickTrilliumApy(trilliumObj) {
  if (!trilliumObj) return null;

  if (Number.isFinite(Number(trilliumObj.average_delegator_total_apy))) {
    return Number(trilliumObj.average_delegator_total_apy);
  }
  if (Number.isFinite(Number(trilliumObj.delegator_total_apy))) {
    return Number(trilliumObj.delegator_total_apy);
  }
  if (Number.isFinite(Number(trilliumObj.total_overall_apy))) {
    return Number(trilliumObj.total_overall_apy);
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
      empty.textContent = "No stake pool data available for this validator (or source unavailable).";
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
    const swOk = r?.sources?.stakewiz && !r?.sources?.stakewiz?.error;
    const trOk = trilliumObj && !trilliumObj?.error && trilliumApy !== null;
    elSourcesNote.textContent = `Sources: Stakewiz ${swOk ? "OK" : "—"} • Trillium ${trOk ? "OK" : "—"}`;
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
    epochCreditsLen: 0
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

      if (!me) {
        console.warn("Vote account not found via RPC:", rpc, "voteKey:", voteKey);
        return { ...EMPTY, status: "not found" };
      }

      const commission = Number(me.commission ?? 0);
      const isDelinquent = delinquent.some((v) => v.votePubkey === me.votePubkey);
      const status = isDelinquent ? "delinquent" : "healthy";

      let uptimePct = 0;
      try {
        const credits = me.epochCredits || [];
        const last6 = credits.slice(-6);
        const deltas = [];

        for (let i = 1; i < last6.length; i++) {
          const prevCredits = last6[i - 1]?.[1] ?? 0;
          const curCredits = last6[i]?.[1] ?? 0;
          deltas.push(Math.max(0, curCredits - prevCredits));
        }

        const window = deltas.slice(-5);
        const maxDelta = Math.max(...window, 1);

        const avgRelative = window.length
          ? window.reduce((sum, d) => sum + d / maxDelta, 0) / window.length
          : 0;

        uptimePct = Math.round(avgRelative * 10000) / 100;
      } catch (err) {
        console.warn("Epoch performance calculation error:", err);
        uptimePct = 0;
      }

      const jito = await fetchJitoStatus(voteKey);

      return {
        commissionHistory: Array(10).fill(commission),
        uptimeLast5EpochsPct: uptimePct,
        jito,
        status,
        votePubkey: me.votePubkey,
        nodePubkey: me.nodePubkey || null,
        epochCreditsLen: (me.epochCredits || []).length
      };
    } catch (err) {
      console.warn("RPC failed:", rpc, err.message || err);
    }
  }

  console.error("All RPCs failed – returning empty state");
  return EMPTY;
}

// ──────────────────────────────────────────────
// NEW: STABILITY (local tracking)
// ──────────────────────────────────────────────

function safeJsonParse(s) {
  try { return JSON.parse(s); } catch { return null; }
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
  } catch {
    // ignore (private mode / blocked storage)
  }
}

function pushSnapshotIfNeeded(voteKey, snap) {
  const snaps = loadSnapshots(voteKey);

  // Avoid saving too often (min 30 minutes between saves)
  const last = snaps.length ? snaps[snaps.length - 1] : null;
  if (last && Number.isFinite(last.t) && (snap.t - last.t) < 30 * 60 * 1000) {
    return snaps;
  }

  snaps.push(snap);

  // Keep last 120 snapshots (lightweight)
  const trimmed = snaps.slice(-120);
  saveSnapshots(voteKey, trimmed);
  return trimmed;
}

function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}

function computeStability({ live, ratings, poolsCount }) {
  const snaps = loadSnapshots(CURRENT.voteKey);

  const n = snaps.length;
  const nowStatus = live?.status || "—";
  const nowUptime = Number(live?.uptimeLast5EpochsPct || 0);
  const nowCommission = Number(live?.commissionHistory?.slice(-1)?.[0] ?? live?.commissionHistory?.slice(-1)?.[0] ?? live?.commissionHistory?.slice(-1)?.[0] ?? 0);

  const sw = Number(ratings?.sources?.stakewiz?.total_apy);
  const tr = pickTrilliumApy(ratings?.sources?.trillium);
  const apyDiff = (Number.isFinite(sw) && Number.isFinite(tr)) ? Math.abs(sw - tr) : null;

  // Historical delinquencies / commission changes
  let delinquentCount = 0;
  let commissionChanges = 0;

  for (let i = 0; i < snaps.length; i++) {
    if (snaps[i]?.status && snaps[i].status !== "healthy") delinquentCount++;
    if (i > 0 && Number.isFinite(snaps[i].commission) && Number.isFinite(snaps[i - 1].commission)) {
      if (snaps[i].commission !== snaps[i - 1].commission) commissionChanges++;
    }
  }

  const delinquentRate = n ? (delinquentCount / n) : 0;

  // Score model (simple, explainable)
  let score = 100;

  if (nowStatus === "delinquent") score -= 40;
  score -= delinquentRate * 40;

  score -= clamp(commissionChanges * 5, 0, 20);

  if (nowUptime < 95) score -= clamp((95 - nowUptime) * 1.5, 0, 20);

  if (apyDiff !== null && apyDiff > 1) score -= clamp((apyDiff - 1) * 5, 0, 15);

  if (!Number.isFinite(poolsCount) || poolsCount <= 0) score -= 10;

  score = clamp(Math.round(score), 0, 100);

  let label = "—";
  if (score >= 85) label = "Strong";
  else if (score >= 70) label = "Good";
  else if (score >= 50) label = "Watch";
  else label = "Risk";

  // Tracking window
  let trackingText = "Today";
  let trackingNote = "Tracking: first visit (data will build over time).";

  if (n >= 2) {
    const t0 = snaps[0].t;
    const t1 = snaps[n - 1].t;
    const days = Math.max(0, (t1 - t0) / (24 * 3600 * 1000));
    const daysNice = days >= 1 ? `${days.toFixed(0)}d` : `${Math.max(1, (days * 24).toFixed(0))}h`;
    trackingText = `${daysNice}`;
    trackingNote = `Tracking: ${n} snapshots stored locally in your browser.`;
  }

  // Pills
  const pills = [];

  // Delinquency pill
  if (n >= 2) {
    pills.push({
      ok: delinquentCount === 0,
      text: delinquentCount === 0 ? "No delinquency observed" : `Delinquency seen (${delinquentCount}/${n})`
    });
  } else {
    pills.push({ ok: nowStatus === "healthy", text: nowStatus === "healthy" ? "Healthy now" : `Status: ${nowStatus}` });
  }

  // Commission stability
  if (n >= 2) {
    pills.push({
      ok: commissionChanges === 0,
      text: commissionChanges === 0 ? "Commission stable" : `Commission changed (${commissionChanges})`
    });
  } else {
    pills.push({ ok: true, text: "Commission tracking builds over time" });
  }

  // Source agreement
  if (apyDiff === null) {
    pills.push({ ok: false, text: "APY agreement: unavailable" });
  } else if (apyDiff <= 0.75) {
    pills.push({ ok: true, text: `APY sources aligned (Δ ${apyDiff.toFixed(2)}%)` });
  } else if (apyDiff <= 1.5) {
    pills.push({ ok: true, text: `APY sources close (Δ ${apyDiff.toFixed(2)}%)` });
  } else {
    pills.push({ ok: false, text: `APY disagreement (Δ ${apyDiff.toFixed(2)}%)` });
  }

  // Voting consistency
  pills.push({
    ok: nowUptime >= 95,
    text: nowUptime >= 95 ? `Voting consistency strong (${nowUptime.toFixed(2)}%)` : `Voting consistency low (${nowUptime.toFixed(2)}%)`
  });

  // Pools
  pills.push({
    ok: Number.isFinite(poolsCount) && poolsCount > 0,
    text: Number.isFinite(poolsCount) && poolsCount > 0 ? `Stake pool presence (${poolsCount})` : "No stake pool presence"
  });

  return { score, label, trackingText, trackingNote, pills };
}

function renderStability(st) {
  const elScore = document.getElementById("stability-score");
  const elLabel = document.getElementById("stability-label");
  const elTracking = document.getElementById("stability-tracking");
  const elPills = document.getElementById("stability-pills");
  const elNote = document.getElementById("stability-note");

  if (elScore) elScore.textContent = `${st.score}`;
  if (elLabel) elLabel.textContent = st.label;
  if (elTracking) elTracking.textContent = st.trackingText;

  if (elPills) {
    elPills.innerHTML = "";
    for (const p of st.pills) {
      const span = document.createElement("span");
      span.className = `pill ${p.ok ? "pill-ok" : "pill-warn"}`;
      span.textContent = p.text;
      elPills.appendChild(span);
    }
  }

  if (elNote) elNote.textContent = st.trackingNote;
}

// ──────────────────────────────────────────────
// MAIN
// ──────────────────────────────────────────────

async function main() {
  const nameEl = document.getElementById("validator-name");
  if (nameEl) {
    const label = CURRENT.nameFromUrl ? CURRENT.nameFromUrl : `vote ${shortKey(CURRENT.voteKey)}`;
    nameEl.textContent = `Validator: ${label}`;
  }

  let data;
  try {
    data = USE_LIVE ? await fetchLive(CURRENT.voteKey) : {
      commissionHistory: [0,0,0,0,0,0,0,0,0,0],
      uptimeLast5EpochsPct: 99.2,
      jito: true,
      status: "healthy"
    };
  } catch (err) {
    console.error("Fatal error in fetchLive:", err);
    data = {
      commissionHistory: Array(10).fill(0),
      uptimeLast5EpochsPct: 0,
      jito: false,
      status: "error",
      votePubkey: null,
      nodePubkey: null,
      epochCreditsLen: 0
    };
  }

  if (nameEl) {
    const finalLabel = CURRENT.nameFromUrl
      ? CURRENT.nameFromUrl
      : (data.nodePubkey ? `node ${shortKey(data.nodePubkey)}` : `vote ${shortKey(CURRENT.voteKey)}`);
    nameEl.textContent = `Validator: ${finalLabel}`;
  }

  // Jito badge
  const jitoBadge = document.getElementById("jito-badge");
  if (jitoBadge) {
    jitoBadge.textContent = `Jito: ${data.jito ? "ON" : "OFF"}`;
    jitoBadge.classList.remove("ok", "warn");
    jitoBadge.classList.add(data.jito ? "ok" : "warn");
  }

  // Commission / epoch performance
  const history = data.commissionHistory || [];
  const latestCommission = history.length ? Number(history[history.length - 1]) : 0;

  const commissionEl = document.getElementById("commission");
  if (commissionEl) commissionEl.textContent = `${Number.isFinite(latestCommission) ? latestCommission.toFixed(0) : 0}%`;

  const uptimeEl = document.getElementById("uptime");
  if (uptimeEl) uptimeEl.textContent = `${Number(data.uptimeLast5EpochsPct || 0).toFixed(2)}%`;

  // Status
  const statusEl = document.getElementById("status");
  if (statusEl) {
    statusEl.textContent = data.status || "—";
    statusEl.classList.remove("ok", "warn");
    statusEl.classList.add(data.status === "healthy" ? "ok" : "warn");
  }

  // Last updated
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

  // Sparkline
  const sparkCanvas = document.getElementById("spark");
  if (sparkCanvas) {
    const series = history.length ? history : Array(10).fill(0);
    drawSpark(sparkCanvas, series);

    const labelEl = document.getElementById("spark-label");
    if (labelEl) {
      const min = Math.min(...series);
      const max = Math.max(...series);
      labelEl.textContent = `Min ${min}% • Max ${max}% • Latest ${Number.isFinite(latestCommission) ? latestCommission.toFixed(0) : 0}%`;
    }
  }

  // Share URL
  updateShareBox();

  // Ratings + Pools + Stability
  let ratings = null;
  try {
    ratings = await fetchRatings(CURRENT.voteKey);
    renderRatings(ratings);
  } catch (e) {
    console.warn("ratings fetch failed:", e);
  }

  // Save snapshot (local)
  const sw = Number(ratings?.sources?.stakewiz?.total_apy);
  const tr = pickTrilliumApy(ratings?.sources?.trillium);
  const poolsCount = Array.isArray(ratings?.pools?.stake_pools) ? ratings.pools.stake_pools.length : null;

  const snap = {
    t: Date.now(),
    status: data.status || null,
    commission: Number.isFinite(latestCommission) ? latestCommission : null,
    uptime: Number.isFinite(Number(data.uptimeLast5EpochsPct)) ? Number(data.uptimeLast5EpochsPct) : null,
    sw_apy: Number.isFinite(sw) ? sw : null,
    tr_apy: Number.isFinite(tr) ? tr : null,
    pools: Number.isFinite(poolsCount) ? poolsCount : null
  };
  pushSnapshotIfNeeded(CURRENT.voteKey, snap);

  // Compute + render stability
  const st = computeStability({ live: data, ratings, poolsCount });
  renderStability(st);
}

main();
