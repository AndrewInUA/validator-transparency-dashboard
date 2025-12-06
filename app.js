/**
 * Validator Transparency Dashboard – app.js
 *
 * 1. Reads your validator vote account (CONFIG).
 * 2. Fetches live data via your Vercel RPC proxy:
 *    - commission
 *    - uptime proxy from epochCredits
 *    - delinquent / healthy status
 * 3. Fetches live Jito status from your Vercel Jito proxy.
 * 4. Renders the Trust Card + sparkline + last updated timestamp.
 */

// ──────────────────────────────────────────────
// CONFIG
// ──────────────────────────────────────────────

// If true → use live data via proxies.
// If false → use MOCK_DATA below.
const USE_LIVE = true;

// Default validator for the dashboard.
const VALIDATOR = {
  name: "AndrewInUA",
  voteKey: "3QPGLackJy5LKctYYoPGmA4P8ncyE197jdxr1zP2ho8K"
};

// Your Vercel proxies.
const JITO_PROXY =
  "https://validator-transparency-dashboard.vercel.app/api/jito";

const RPC_PROXY =
  "https://validator-transparency-dashboard.vercel.app/api/rpc";


// ──────────────────────────────────────────────
// URL overrides (?vote=&name=) – optional
// ──────────────────────────────────────────────
//
// This lets any other validator reuse the same page without forking:
//   https://.../dashboard/?vote=VOTE_PUBKEY&name=NiceValidator

(function applyUrlOverrides() {
  const params = new URLSearchParams(window.location.search);
  const vote = params.get("vote");
  const name = params.get("name");

  if (vote) VALIDATOR.voteKey = vote.trim();
  if (name) VALIDATOR.name = name.trim();
})();


// ──────────────────────────────────────────────
// MOCK DATA (used only if USE_LIVE === false)
// ──────────────────────────────────────────────

const MOCK_DATA = {
  commissionHistory: [8, 8, 8, 7, 7, 7, 6, 6, 6, 6],
  uptimeLast5EpochsPct: 99.2,
  jito: true,
  status: "healthy"
};

// Fallback state when proxies / RPC fail.
const EMPTY_STATE = {
  commissionHistory: Array(10).fill(0),
  uptimeLast5EpochsPct: 0,
  jito: false,
  status: "error"
};


// ──────────────────────────────────────────────
// HELPERS
// ──────────────────────────────────────────────

/**
 * Draws a simple sparkline for commission history.
 */
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

/**
 * Ask the Vercel proxy if this vote account runs Jito.
 * api/jito.js should return { jito: true/false, ... }.
 */
async function fetchJitoStatus(voteKey) {
  if (!JITO_PROXY) return false;

  try {
    const url = `${JITO_PROXY}?vote=${encodeURIComponent(voteKey)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Jito proxy HTTP ${res.status}`);

    const json = await res.json();
    console.log("Jito proxy response:", json);
    return !!json.jito;
  } catch (err) {
    console.warn("Jito check failed:", err);
    return false;
  }
}


// ──────────────────────────────────────────────
// LIVE DATA: via Vercel RPC proxy
// ──────────────────────────────────────────────
//
// Expects /api/rpc?vote=<VOTEKEY> to return:
// {
//   ok: true,
//   data: { ...voteAccountFields },
//   delinquent: false
// }

async function fetchLive() {
  if (!RPC_PROXY) {
    console.error("RPC_PROXY not configured");
    return EMPTY_STATE;
  }

  try {
    const url = `${RPC_PROXY}?vote=${encodeURIComponent(VALIDATOR.voteKey)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`RPC proxy HTTP ${res.status}`);

    const json = await res.json();
    console.log("RPC proxy response:", json);

    if (!json || !json.ok || !json.data) {
      console.warn("RPC proxy: no data for this vote account");
      return { ...EMPTY_STATE, status: "not found" };
    }

    const me = json.data;

    const commission = Number(me.commission ?? 0);

    // Uptime approximation from epochCredits [[epoch, credits, prevCredits], ...]
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
      console.warn("Uptime calculation error:", err);
      uptimePct = 0;
    }

    const jito = await fetchJitoStatus(VALIDATOR.voteKey);

    const isDelinquent = !!json.delinquent;
    const status = isDelinquent ? "delinquent" : "healthy";

    return {
      commissionHistory: Array(10).fill(commission),
      uptimeLast5EpochsPct: uptimePct,
      jito,
      status
    };
  } catch (err) {
    console.error("fetchLive via RPC proxy failed:", err);
    return EMPTY_STATE;
  }
}


// ──────────────────────────────────────────────
// MAIN: fetch + render
// ──────────────────────────────────────────────

async function main() {
  // Show validator name immediately
  const nameEl = document.getElementById("validator-name");
  if (nameEl) {
    nameEl.textContent = `Validator: ${VALIDATOR.name}`;
  }

  let data;

  try {
    data = USE_LIVE ? await fetchLive() : MOCK_DATA;
  } catch (err) {
    console.error("Fatal error in fetchLive:", err);
    data = EMPTY_STATE;
  }

  console.log("Dashboard mode:", USE_LIVE ? "LIVE" : "MOCK", data);

  // ── Jito badge ─────────────────────────────────────────────
  const jitoBadge = document.getElementById("jito-badge");
  if (jitoBadge) {
    jitoBadge.textContent = `Jito: ${data.jito ? "ON" : "OFF"}`;
    jitoBadge.classList.remove("ok", "warn");
    jitoBadge.classList.add(data.jito ? "ok" : "warn");
  }

  // ── Commission / uptime ────────────────────────────────────
  const history = data.commissionHistory || [];
  const latestCommission = history.length
    ? Number(history[history.length - 1])
    : 0;

  const commissionEl = document.getElementById("commission");
  if (commissionEl) {
    commissionEl.textContent =
      `${Number.isFinite(latestCommission) ? latestCommission.toFixed(0) : 0}%`;
  }

  const uptimeEl = document.getElementById("uptime");
  if (uptimeEl) {
    uptimeEl.textContent =
      `${Number(data.uptimeLast5EpochsPct || 0).toFixed(2)}%`;
  }

  // ── Status ─────────────────────────────────────────────────
  const statusEl = document.getElementById("status");
  if (statusEl) {
    statusEl.textContent = data.status || "—";
    statusEl.classList.remove("ok", "warn");
    statusEl.classList.add(data.status === "healthy" ? "ok" : "warn");
  }

  // ── Last updated ───────────────────────────────────────────
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

  // ── Sparkline ──────────────────────────────────────────────
  const sparkCanvas = document.getElementById("spark");
  if (sparkCanvas) {
    const series = history.length ? history : Array(10).fill(0);
    drawSpark(sparkCanvas, series);

    const labelEl = document.getElementById("spark-label");
    if (labelEl) {
      const min = Math.min(...series);
      const max = Math.max(...series);
      labelEl.textContent =
        `Min ${min}% • Max ${max}% • Latest ${
          Number.isFinite(latestCommission)
            ? latestCommission.toFixed(0)
            : 0
        }%`;
    }
  }
}

main();
