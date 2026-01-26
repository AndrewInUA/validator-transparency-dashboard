/**
 * Validator Transparency Dashboard – app.js
 *
 * 1. Reads your validator vote account (CONFIG).
 * 2. Fetches live data from Solana JSON-RPC:
 *    - commission
 *    - epoch performance proxy from epochCredits
 *    - delinquent / healthy status
 * 3. Fetches live Jito status from your Vercel proxy.
 * 4. Renders Trust Card, sparkline, last updated timestamp, and share URL.
 * 5. Fetches APY + stake pool presence from /api/ratings (Stakewiz + Trillium).
 */

// ──────────────────────────────────────────────
// CONFIG
// ──────────────────────────────────────────────

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
// MOCK DATA (used only if USE_LIVE === false)
// ──────────────────────────────────────────────

const MOCK_DATA = {
  commissionHistory: [8, 8, 8, 7, 7, 7, 6, 6, 6, 6],
  uptimeLast5EpochsPct: 99.2,
  jito: true,
  status: "healthy"
};

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
    console.log("Jito proxy response:", json, "voteKey:", voteKey);
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

// ──────────────────────────────────────────────
// ratings + pools (via our API)
// ──────────────────────────────────────────────

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

/**
 * Trillium APY selection (fixes the 0.00% issue):
 * Prefer "average_delegator_total_apy" (correct total APY for delegators).
 * Fallback to older fields if your API currently returns them.
 */
function pickTrilliumApy(trilliumObj) {
  if (!trilliumObj) return null;

  // ✅ Correct (matches Trillium dataset field name)
  if (Number.isFinite(Number(trilliumObj.average_delegator_total_apy))) {
    return Number(trilliumObj.average_delegator_total_apy);
  }

  // Common alternative naming patterns (in case your API mapped it differently)
  if (Number.isFinite(Number(trilliumObj.delegator_total_apy))) {
    return Number(trilliumObj.delegator_total_apy);
  }

  // Older / less ideal fallback (overall APY)
  if (Number.isFinite(Number(trilliumObj.total_overall_apy))) {
    return Number(trilliumObj.total_overall_apy);
  }

  return null;
}

function renderRatings(r) {
  const elMedian = document.getElementById("apy-median");
  const elStakewiz = document.getElementById("apy-stakewiz");
  const elTrillium = document.getElementById("apy-trillium");
  const elTrilliumStatus = document.getElementById("trillium-status"); // optional element in index.html
  const elPoolsCount = document.getElementById("pools-count");
  const elPoolsTotals = document.getElementById("pools-totals");
  const elPoolsList = document.getElementById("pools-list");
  const elSourcesNote = document.getElementById("apy-sources-note");

  if (elMedian) elMedian.textContent = fmtPct(r?.derived?.apy_median);
  if (elStakewiz) elStakewiz.textContent = fmtPct(r?.sources?.stakewiz?.total_apy);

  // ✅ FIX: Use delegator total APY from Trillium when available
  const trilliumObj = r?.sources?.trillium;
  const trilliumApy = pickTrilliumApy(trilliumObj);

  if (elTrillium) elTrillium.textContent = fmtPct(trilliumApy);

  // Optional: show real Trillium status under the Trillium KPI (if element exists)
  if (elTrilliumStatus) {
    const trOk = trilliumObj && !trilliumObj?.error && trilliumApy !== null;
    elTrilliumStatus.textContent = trOk ? "Source: Trillium OK" : "Source: Trillium error";
  }

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
        headers: {
          "content-type": "application/json",
          accept: "application/json"
        },
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
          const delta = Math.max(0, curCredits - prevCredits);
          deltas.push(delta);
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
// MAIN
// ──────────────────────────────────────────────

async function main() {
  const nameEl = document.getElementById("validator-name");
  if (nameEl) {
    const label = CURRENT.nameFromUrl
      ? CURRENT.nameFromUrl
      : `vote ${shortKey(CURRENT.voteKey)}`;
    nameEl.textContent = `Validator: ${label}`;
  }

  let data;

  try {
    data = USE_LIVE ? await fetchLive(CURRENT.voteKey) : MOCK_DATA;
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
      : (data.nodePubkey
          ? `node ${shortKey(data.nodePubkey)}`
          : `vote ${shortKey(CURRENT.voteKey)}`);
    nameEl.textContent = `Validator: ${finalLabel}`;
  }

  // ── Jito badge
  const jitoBadge = document.getElementById("jito-badge");
  if (jitoBadge) {
    jitoBadge.textContent = `Jito: ${data.jito ? "ON" : "OFF"}`;
    jitoBadge.classList.remove("ok", "warn");
    jitoBadge.classList.add(data.jito ? "ok" : "warn");
  }

  // ── Commission / epoch performance
  const history = data.commissionHistory || [];
  const latestCommission = history.length ? Number(history[history.length - 1]) : 0;

  const commissionEl = document.getElementById("commission");
  if (commissionEl) {
    commissionEl.textContent = `${
      Number.isFinite(latestCommission) ? latestCommission.toFixed(0) : 0
    }%`;
  }

  const uptimeEl = document.getElementById("uptime");
  if (uptimeEl) {
    uptimeEl.textContent = `${Number(data.uptimeLast5EpochsPct || 0).toFixed(2)}%`;
  }

  // ── Status
  const statusEl = document.getElementById("status");
  if (statusEl) {
    statusEl.textContent = data.status || "—";
    statusEl.classList.remove("ok", "warn");
    statusEl.classList.add(data.status === "healthy" ? "ok" : "warn");
  }

  // ── Last updated
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

  // ── Sparkline
  const sparkCanvas = document.getElementById("spark");
  if (sparkCanvas) {
    const series = history.length ? history : Array(10).fill(0);
    drawSpark(sparkCanvas, series);

    const labelEl = document.getElementById("spark-label");
    if (labelEl) {
      const min = Math.min(...series);
      const max = Math.max(...series);
      labelEl.textContent = `Min ${min}% • Max ${max}% • Latest ${
        Number.isFinite(latestCommission) ? latestCommission.toFixed(0) : 0
      }%`;
    }
  }

  // ── Share URL
  updateShareBox();

  // ── APY + Pools
  try {
    const ratings = await fetchRatings(CURRENT.voteKey);
    renderRatings(ratings);
  } catch (e) {
    console.warn("ratings fetch failed:", e);
  }
}

main();
