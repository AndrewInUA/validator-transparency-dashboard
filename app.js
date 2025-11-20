// --- CONFIG ---
const USE_LIVE = true; // live mode ON
const VALIDATOR = {
  name: "AndrewInUA",
  voteKey: "3QPGLackJy5LKctYYoPGmA4P8ncyE197jdxr1zP2ho8K", // vote account
};

// If you deployed the proxy on Vercel, paste it here, e.g.:
// const JITO_PROXY = "https://your-project.vercel.app/api/jito";
const JITO_PROXY = "";

// --- MOCK DATA (fallback demo) ---
const mock = {
  commissionHistory: [8, 8, 8, 7, 7, 7, 6, 6, 6, 6],
  uptimeLast5EpochsPct: 99.2,
  jito: false,
  status: "healthy",
};

// --- Helpers ---
function drawSpark(canvas, values) {
  const ctx = canvas.getContext("2d");
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  const min = Math.min(...values), max = Math.max(...values), pad = 4;

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

const short = (s) => (s ? s.slice(0, 4) + "…" + s.slice(-4) : "—");

// Try Jito directly (may CORS-fail), else via proxy if provided
async function fetchJito(voteKey) {
  const direct = "https://mainnet.block-engine.jito.wtf/api/v1/validators";
  // 1) direct attempt
  try {
    const r = await fetch(direct, { headers: { accept: "application/json" } });
    if (r.ok) {
      const list = await r.json();
      const arr = Array.isArray(list) ? list : Array.isArray(list?.validators) ? list.validators : [];
      const getKey = (o) =>
        o?.vote_identity || o?.voteIdentity ||
        o?.vote_identity_pubkey || o?.voteIdentityPubkey ||
        o?.vote_identity_pubkey_str || o?.voteIdentityPubkeyStr ||
        o?.votePubkey || null;
      const hit = arr.find(v => String(getKey(v) || "").trim() === voteKey);
      return !!hit;
    }
  } catch (_) {}
  // 2) proxy attempt
  if (JITO_PROXY) {
    try {
      const r = await fetch(`${JITO_PROXY}?vote=${encodeURIComponent(voteKey)}`);
      if (r.ok) {
        const json = await r.json();
        return !!json?.jito;
      }
    } catch (_) {}
  }
  // unknown / failed
  return false;
}

// --- Live data via RPC (with RPC fallbacks) ---
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
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify(reqBody),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} at ${rpc}`);
      const json = await res.json();
      const cur = json?.result?.current || [];
      const del = json?.result?.delinquent || [];
      const all = cur.concat(del);

      const me = all.find((v) => v.votePubkey === VALIDATOR.voteKey);
      if (!me) return { ...baseEmpty, status: "not found" };

      const commission = Number(me.commission ?? 0);
      const isDelinquent = del.some((v) => v.votePubkey === me.votePubkey);
      const status = isDelinquent ? "delinquent" : "healthy";

      // relative uptime proxy from epoch credits
      let uptimePct = 0;
      try {
        const credits = me.epochCredits || [];
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
      } catch {
        uptimePct = 0;
      }

      // JITO
      const jito = await fetchJito(VALIDATOR.voteKey);

      console.log("LIVE via:", rpc, { commission, status, uptimePct, jito });
      return {
        commissionHistory: Array(10).fill(commission),
        uptimeLast5EpochsPct: uptimePct,
        jito,
        status,
      };
    } catch (e) {
      console.warn("RPC failed:", e?.message || e);
    }
  }
  return baseEmpty;
}

async function main() {
  // show your name instantly
  document.getElementById("validator-name").textContent = `Validator: ${VALIDATOR.name}`;

  const data = USE_LIVE ? await fetchLive() : mock;
  console.log("MODE:", USE_LIVE ? "LIVE" : "MOCK", data);

  const jito = document.getElementById("jito-badge");
  jito.textContent = `Jito: ${data.jito ? "ON" : "OFF"}`;
  jito.classList.add(data.jito ? "ok" : "warn");

  const last = (data.commissionHistory && data.commissionHistory.length)
    ? Number(data.commissionHistory.at(-1)) : 0;

  document.getElementById("commission").textContent = `${Number.isFinite(last) ? last.toFixed(0) : 0}%`;
  document.getElementById("uptime").textContent = `${Number(data.uptimeLast5EpochsPct || 0).toFixed(2)}%`;

  const statusEl = document.getElementById("status");
  statusEl.textContent = data.status || "—";
  statusEl.classList.add(data.status === "healthy" ? "ok" : "warn");

  const spark = document.getElementById("spark");
  drawSpark(spark, (data.commissionHistory && data.commissionHistory.length) ? data.commissionHistory : Array(10).fill(0));
  document.getElementById("spark-label").textContent =
    `Min ${Math.min(...((data.commissionHistory && data.commissionHistory.length) ? data.commissionHistory : [0]))}% • ` +
    `Max ${Math.max(...((data.commissionHistory && data.commissionHistory.length) ? data.commissionHistory : [0]))}% • ` +
    `Latest ${Number.isFinite(last) ? last.toFixed(0) : 0}%`;
}

main();
