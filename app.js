// --- CONFIG ---
const USE_LIVE = true; // live mode ON
const VALIDATOR = {
  name: "AndrewInUA",
  voteKey: "3QPGLackJy5LKctYYoPGmA4P8ncyE197jdxr1zP2ho8K", // vote account pubkey
};

// --- MOCK DATA (kept for fallback demos) ---
const mock = {
  commissionHistory: [8, 8, 8, 7, 7, 7, 6, 6, 6, 6],
  uptimeLast5EpochsPct: 99.2,
  jito: true,
  status: "healthy",
};

// --- Simple sparkline drawer ---
function drawSpark(canvas, values) {
  const ctx = canvas.getContext("2d");
  const w = canvas.width, h = canvas.height;
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

// --- Live data via Solana JSON-RPC with automatic fallbacks ---
async function fetchLive() {
  // Try these in order; the first that works wins
  const RPCS = [
    "https://solana-mainnet.g.alchemy.com/v2/demo",     // CORS-friendly demo
    "https://api.mainnet-beta.solana.com",              // official (may CORS-block)
    "https://rpc.ankr.com/solana",                      // often 403 without key
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

  let lastErr = null;

  for (const rpc of RPCS) {
    try {
      const res = await fetch(rpc, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify(reqBody),
      });

      if (!res.ok) throw new Error(`HTTP ${res.status} at ${rpc}`);
      const json = await res.json();
      if (!json?.result) throw new Error(`Malformed response from ${rpc}`);

      const current = json.result.current || [];
      const delinquent = json.result.delinquent || [];
      const all = current.concat(delinquent);

      const me = all.find((v) => v.votePubkey === VALIDATOR.voteKey);
      if (!me) {
        console.warn("Vote account not found in getVoteAccounts:", VALIDATOR.voteKey, "via", rpc);
        return { ...baseEmpty, status: "not found" };
      }

      const commission = Number(me.commission ?? 0);
      const isDelinquent = delinquent.some((v) => v.votePubkey === me.votePubkey);
      const status = isDelinquent ? "delinquent" : "healthy";

      // Relative “uptime” proxy from recent epoch credits
      let uptimePct = 0;
      try {
        const credits = me.epochCredits || []; // [[epoch, credits, prev], ...], newest last
        const last6 = credits.slice(-6);
        const deltas = [];
        for (let i = 1; i < last6.length; i++) {
          const delta = Math.max(0, (last6[i]?.[1] ?? 0) - (last6[i - 1]?.[1] ?? 0));
          deltas.push(delta);
        }
        const window = deltas.slice(-5);
        const maxDelta = Math.max(...window, 1);
        const avgRel = window.length ? window.reduce((a, b) => a + b / maxDelta, 0) / window.length : 0;
        uptimePct = Math.round(avgRel * 10000) / 100;
      } catch (e) {
        console.warn("Uptime calc error:", e);
        uptimePct = 0;
      }

      console.log("LIVE via:", rpc, { commission, status, uptimePct });
      return {
        commissionHistory: Array(10).fill(commission),
        uptimeLast5EpochsPct: uptimePct,
        jito: false, // Jito wiring next
        status,
      };
    } catch (e) {
      lastErr = e;
      console.warn("RPC failed:", rpc, e?.message || e);
      // Try next RPC in the list
    }
  }

  console.error("All RPCs failed:", lastErr?.message || lastErr);
  return baseEmpty;
}

async function main() {
  // Show name immediately so UI never looks empty
  document.getElementById("validator-name").textContent = `Validator: ${VALIDATOR.name}`;

  // Get data
  const data = USE_LIVE ? await fetchLive() : mock;
  console.log("MODE:", USE_LIVE ? "LIVE" : "MOCK", data);

  // Jito badge (placeholder until we wire real Jito status)
  const jito = document.getElementById("jito-badge");
  jito.textContent = `Jito: ${data.jito ? "ON" : "OFF"}`;
  jito.classList.add(data.jito ? "ok" : "warn");

  // Commission / uptime with guards
  const last = (data.commissionHistory && data.commissionHistory.length)
    ? Number(data.commissionHistory.at(-1))
    : 0;

  document.getElementById("commission").textContent = `${Number.isFinite(last) ? last.toFixed(0) : 0}%`;
  document.getElementById("uptime").textContent = `${Number(data.uptimeLast5EpochsPct || 0).toFixed(2)}%`;

  // Status
  const statusEl = document.getElementById("status");
  statusEl.textContent = data.status || "—";
  statusEl.classList.add(data.status === "healthy" ? "ok" : "warn");

  // Sparkline (guarded)
  const spark = document.getElementById("spark");
  drawSpark(spark, (data.commissionHistory && data.commissionHistory.length) ? data.commissionHistory : Array(10).fill(0));
  document.getElementById("spark-label").textContent =
    `Min ${Math.min(...((data.commissionHistory && data.commissionHistory.length) ? data.commissionHistory : [0]))}% • ` +
    `Max ${Math.max(...((data.commissionHistory && data.commissionHistory.length) ? data.commissionHistory : [0]))}% • ` +
    `Latest ${Number.isFinite(last) ? last.toFixed(0) : 0}%`;
}

main();
