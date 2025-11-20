/**
 * Validator Transparency Dashboard – app.js
 *
 * What this file does:
 * 1. Reads your validator vote account (CONFIG section).
 * 2. Fetches live data from Solana JSON-RPC:
 *    - commission
 *    - epoch credits → relative “uptime”
 *    - delinquent / healthy status
 * 3. Fetches live Jito status from your Vercel proxy.
 * 4. Renders the Trust Card + sparkline on the page.
 *
 * You can flip between live and mock data with USE_LIVE.
 */

// ───────────────────────────────────────────────────────────────
// CONFIG
// ───────────────────────────────────────────────────────────────

// If true → use Solana RPC + Jito proxy.
// If false → use the MOCK object at the bottom (for demo / offline).
const USE_LIVE = true;

// Your validator identity for the dashboard.
// name: how it’s displayed
// voteKey: vote account public key (the one in the Solana explorer)
const VALIDATOR = {
  name: "AndrewInUA",
  voteKey: "3QPGLackJy5LKctYYoPGmA4P8ncyE197jdxr1zP2ho8K"
};

// Jito proxy hosted on Vercel. This is the backend we wrote in api/jito.js.
// It calls https://kobe.mainnet.jito.network/api/v1/validators on your behalf
// and returns JSON like { jito: true/false, ... }.
const JITO_PROXY =
  "https://validator-transparency-dashboard.vercel.app/api/jito";


// ───────────────────────────────────────────────────────────────
// URL OVERRIDES (optional)
// ───────────────────────────────────────────────────────────────
//
// This lets *other* validators re-use the same page without forking.
// Example:
//   https://.../validator-transparency-dashboard/?vote=VOTE_PUBKEY&name=MyNode
//
// It will override VALIDATOR.voteKey and VALIDATOR.name on the fly.

(function applyUrlOverrides() {
  const params = new URLSearchParams(window.location.search);
  const vote = params.get("vote");
  const name = params.get("name");

  if (vote) VALIDATOR.voteKey = vote.trim();
  if (name) VALIDATOR.name = name.trim();
})();


// ───────────────────────────────────────────────────────────────
// MOCK DATA (for demo/testing)
// ───────────────────────────────────────────────────────────────
//
// Used only when USE_LIVE === false.
// You can tweak these to show a nice static card when offline.

const MOCK_DATA = {
  commissionHistory: [8, 8, 8, 7, 7, 7, 6, 6, 6, 6],
  uptimeLast5EpochsPct: 99.2,
  jito: true,
  status: "healthy"
};


// ───────────────────────────────────────────────────────────────
// SMALL HELPERS
// ───────────────────────────────────────────────────────────────

/**
 * Draws a simple line chart (sparkline) for the commission history.
 * @param {HTMLCanvasElement} canvas
 * @param {number[]} values
 */
function drawSpark(canvas, values) {
  const ctx = canvas.getContext("2d");
  const w = canvas.width;
  const h = canvas.height;

  // Clear previous drawing
  ctx.clearRect(0, 0, w, h);

  const min = Math.min(...values);
  const max = Math.max(...values);
  const pad = 4; // padding inside the canvas

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
 * Fetch Jito status from your Vercel proxy.
 * Returns true if the proxy says jito: true, otherwise false.
 */
async function fetchJitoStatus(voteKey) {
  // If you ever want to run without Jito proxy, just set JITO_PROXY = "".
  if (!JITO_PROXY) return false;

  try {
    const url = `${JITO_PROXY}?vote=${encodeURIComponent(voteKey)}`;
    const res = await fetch(url);

    if (!res.ok) throw new Error(`Jito proxy HTTP ${res.status}`);

    const json = await res.json();
    console.log("Jito proxy response:", json);

    // Our api/jito.js sets { jito: running_jito }
    return !!json.jito;
  } catch (err) {
    console.warn("Jito check failed:", err);
    // On error we show OFF rather than breaking the whole card.
    return false;
  }
}


// ───────────────────────────────────────────────────────────────
// LIVE DATA: Solana JSON-RPC
// ───────────────────────────────────────────────────────────────
//
// Main job:
//  - call getVoteAccounts on one of the RPCs below,
//  - find your vote account,
//  - compute stats (commission, uptime, status),
//  - call Jito proxy for jito: ON/OFF,
//  - return a { commissionHistory, uptimeLast5EpochsPct, jito, status } object.
//

async function fetchLive() {
  // RPC endpoints to try in order; first successful one wins.
  const RPCS = [
    "https://solana-mainnet.g.alchemy.com/v2/demo", // CORS-friendly demo
    "https://api.mainnet-beta.solana.com",          // official
    "https://rpc.ankr.com/solana"                   // extra fallback
  ];

  const requestBody = {
    jsonrpc: "2.0",
    id: 1,
    method: "getVoteAccounts",
    params: [{ commitment: "finalized" }]
  };

  // Fallback shape when everything fails or vote account not found.
  const EMPTY = {
    commissionHistory: Array(10).fill(0),
    uptimeLast5EpochsPct: 0,
    jito: false,
    status: "error"
  };

  // Try each RPC one by one
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

      // Find our vote account in the list
      const me = all.find((v) => v.votePubkey === VALIDATOR.voteKey);

      if (!me) {
        console.warn("Vote account not found via RPC:", rpc);
        return { ...EMPTY, status: "not found" };
      }

      // Commission is directly provided as an integer (e.g. 0, 5, 6)
      const commission = Number(me.commission ?? 0);

      // Determine delinquent vs healthy based on which array it came from.
      const isDelinquent = delinquent.some(
        (v) => v.votePubkey === me.votePubkey
      );
      const status = isDelinquent ? "delinquent" : "healthy";

      // Uptime approximation based on recent epochCredits.
      // epochCredits is [[epoch, credits, prev_credits], ...].
      let uptimePct = 0;

      try {
        const credits = me.epochCredits || [];
        const last6 = credits.slice(-6); // last 6 epochs (if available)
        const deltas = [];

        for (let i = 1; i < last6.length; i++) {
          const prevCredits = last6[i - 1]?.[1] ?? 0;
          const curCredits = last6[i]?.[1] ?? 0;
          const delta = Math.max(0, curCredits - prevCredits);
          deltas.push(delta);
        }

        // Last 5 deltas → relative “voting uptime”
        const window = deltas.slice(-5);
        const maxDelta = Math.max(...window, 1); // avoid division by 0

        const avgRelative = window.length
          ? window.reduce((sum, d) => sum + d / maxDelta, 0) / window.length
          : 0;

        // Convert 0–1 range to percentage with 2 decimal places
        uptimePct = Math.round(avgRelative * 10000) / 100;
      } catch (err) {
        console.warn("Uptime calculation error:", err);
        uptimePct = 0;
      }

      // Jito ON/OFF from our proxy
      const jito = await fetchJitoStatus(VALIDATOR.voteKey);

      console.log("LIVE via RPC:", rpc, {
        commission,
        status,
        uptimePct,
        jito
      });

      return {
        commissionHistory: Array(10).fill(commission),
        uptimeLast5EpochsPct: uptimePct,
        jito,
        status
      };
    } catch (err) {
      console.warn("RPC failed:", rpc, err.message || err);
      // Move on to the next RPC in the list
    }
  }

  console.error("All RPCs failed – returning empty state");
  return EMPTY;
}


// ───────────────────────────────────────────────────────────────
// MAIN: fetch data + render UI
// ───────────────────────────────────────────────────────────────

async function main() {
  // Show validator name immediately (even before data loads)
  const nameEl = document.getElementById("validator-name");
  if (nameEl) {
    nameEl.textContent = `Validator: ${VALIDATOR.name}`;
  }

  // Decide which data source to use
  const data = USE_LIVE ? await fetchLive() : MOCK_DATA;
  console.log("Dashboard mode:", USE_LIVE ? "LIVE" : "MOCK", data);

  // ── Jito badge ──────────────────────────────────────────────
  const jitoBadge = document.getElementById("jito-badge");
  if (jitoBadge) {
    jitoBadge.textContent = `Jito: ${data.jito ? "ON" : "OFF"}`;
    jitoBadge.classList.remove("ok", "warn");
    jitoBadge.classList.add(data.jito ? "ok" : "warn");
  }

  // ── Commission & uptime ─────────────────────────────────────
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

  // ── Status badge ────────────────────────────────────────────
  const statusEl = document.getElementById("status");
  if (statusEl) {
    statusEl.textContent = data.status || "—";
    statusEl.classList.remove("ok", "warn");
    statusEl.classList.add(data.status === "healthy" ? "ok" : "warn");
  }

  // ── Sparkline chart ─────────────────────────────────────────
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

// Kick everything off
main();
