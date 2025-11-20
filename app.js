// --- CONFIG ----------------------------------------------------
const USE_LIVE = true; // live mode ON

const VALIDATOR = {
  name: "AndrewInUA",
  // Your vote account:
  voteKey: "3QPGLackJy5LKctYYoPGmA4P8ncyE197jdxr1zP2ho8K",
};

// Jito proxy hosted on Vercel (update if you rename the project)
const JITO_PROXY =
  "https://validator-transparency-dashboard.vercel.app/api/jito";

// --- OPTIONAL: URL overrides -----------------------------------
// Allow ?vote=...&name=... so others can reuse the page
(function () {
  const q = new URLSearchParams(location.search);
  const vote = q.get("vote");
  const name = q.get("name");
  if (vote) VALIDATOR.voteKey = vote;
  if (name) VALIDATOR.name = name;
})();

// --- MOCK DATA (used if USE_LIVE = false) ----------------------
const mock = {
  commissionHistory: [8, 8, 8, 7, 7, 7, 6, 6, 6, 6],
  uptimeLast5EpochsPct: 99.2,
  jito: true,
  status: "healthy",
};

// --- Helpers ---------------------------------------------------
function drawSpark(canvas, values) {
  const ctx = canvas.getContext("2d");
  const w = canvas.width,
    h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  const min = Math.min(...values);
  const max = Math.max(...values);
  const pad = 4;

  ctx.beginPath();
  values.forEach((v, i) => {
    const x = pad + (i * (w - 2 * pad)) / (values.length - 1);
    const y = h - pad - ((v - min) / ((max - min) || 1)) * (h - 2 * pad);
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  });
  ctx.lineWidth = 2;
  ctx.strokeStyle = "#8bd5ff";
  ctx.stroke();
}

// Fetch Jito status via your Vercel proxy
async function fetchJitoStatus(voteKey) {
  if (!JITO_PROXY) return false;

  try {
    const url = `${JITO_PROXY}?vote=${encodeURIComponent(voteKey)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    console.log("Jito proxy response:", json);
    return !!json.jito; // true if running_jito according to API
  } catch (e) {
    console.warn("Jito check failed:", e);
    return false;
  }
}

// --- Live data via Solana JSON-RPC -----------------------------
async function fetchLive() {
  const RPCS = [
    "https://solana-mainnet.g.alchemy.com/v2/demo",
    "https://api.mainnet-beta.solana.com",
    "https://rpc.ankr.com/solana",
  ];

  const reqBody = {
    jsonrpc: "2.0",
    id: 1,
    method: "getVoteAccounts",
    params: [{ commitment: "finalized" }],
  };

  const baseEmpty = {
    commissionHistory: Array(10).fill(0),
    uptimeLast5EpochsPct: 0,
    jito: false,
    status: "error",
  };

  for (const rpc of RPCS) {
    try {
      const res = await fetch(rpc, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify(reqBody),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} at ${rpc}`);

      const json = await res.json();
      const current = json?.result?.current || [];
      const delinquent = json?.result?.delinquent || [];
      const all = current.concat(delinquent);

      const me = all.find((v) => v.votePubkey === VALIDATOR.voteKey);
      if (!me) {
        console.warn("Vote account not found via", rpc);
        return { ...baseEmpty, status: "not found" };
      }

      const commission = Number(me.commission ?? 0);
      const isDelinquent = delinquent.some(
        (v) => v.votePubkey === me.votePubkey
      );
      const status = isDelinquent ? "delinquent" : "healthy";

      // Relative "uptime" proxy from epochCredits
      let uptimePct = 0;
      try {
        const credits = me.epochCredits || []; // [[epoch, credits, prev], ...]
        const last6 = credits.slice(-6);
        const deltas = [];
        for (let i = 1; i < last6.length; i++) {
          const prev = last6[i - 1]?.[1] ?? 0;
          const cur = last6[i]?.[1] ?? 0;
          const delta = Math.max(0, cur - prev);
          deltas.push(delta);
        }
        const window = deltas.slice(-5);
        const maxDelta = Math.max(...window, 1);
        const avgRel = window.length
          ? window.reduce((a, b) => a + b / maxDelta, 0) / window.length
          : 0;
        uptimePct = Math.round(avgRel * 10000) / 100;
      } catch (e) {
        console.warn("Uptime calc error:", e);
        uptimePct = 0;
      }

      // REAL JITO STATUS
      const jito = await fetchJitoStatus(VALIDATOR.voteKey);

      console.log("LIVE via:", rpc, {
        commission,
        status,
        uptimePct,
        jito,
      });

      return {
        commissionHistory: Array(10).fill(commission),
        uptimeLast5EpochsPct: uptimePct,
        jito,
        status,
      };
    } catch (e) {
      console.warn("RPC failed:", rpc, e.message || e);
      // try next RPC in list
    }
  }

  console.error("All RPCs failed, falling back to empty state");
  return baseEmpty;
}

// --- Main ------------------------------------------------------
async function main() {
  // Show validator name immediately
  document.getElementById("validator-name").textContent =
    `Validator: ${VALIDATOR.name}`;

  const data = USE_LIVE ? await fetchLive() : mock;
  console.log("MODE:", USE_LIVE ? "LIVE" : "MOCK", data);

  // Jito badge
  const jitoBadge = document.getElementById("jito-badge");
  jitoBadge.textContent = `Jito: ${data.jito ? "ON" : "OFF"}`;
  jitoBadge.classList.remove("ok", "warn");
  jitoBadge.classList.add(data.jito ? "ok" : "warn");

  // Commission / uptime
  const last = (data.commissionHistory && data.commissionHistory.length)
    ? Number(data.commissionHistory.at(-1))
    : 0;

  document.getElementById("commission").textContent =
    `${Number.isFinite(last) ? last.toFixed(0) : 0}%`;

  document.getElementById("uptime").textContent =
    `${Number(data.uptimeLast5EpochsPct || 0).toFixed(2)}%`;

  // Status
  const statusEl = document.getElementById("status");
  statusEl.textContent = data.status || "—";
  statusEl.classList.remove("ok", "warn");
  statusEl.classList.add(data.status === "healthy" ? "ok" : "warn");

  // Sparkline
  const spark = document.getElementById("spark");
  const series =
    data.commissionHistory && data.commissionHistory.length
      ? data.commissionHistory
      : Array(10).fill(0);

  drawSpark(spark, series);

  document.getElementById("spark-label").textContent =
    `Min ${Math.min(...series)}% • ` +
    `Max ${Math.max(...series)}% • ` +
    `Latest ${Number.isFinite(last) ? last.toFixed(0) : 0}%`;
}

main();
