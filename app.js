// --- CONFIG ---
const USE_LIVE = true;
const VALIDATOR = {
  name: "AndrewInUA",
  voteKey: "3QPGLackJy5LKctYYoPGmA4P8ncyE197jdxr1zP2ho8K"
};
// When USE_LIVE=true, set your keys in a .env on your real build (Vercel) and read via server endpoints.

// --- MOCK DATA (runs instantly) ---
const mock = {
  commissionHistory: [8, 8, 8, 7, 7, 7, 6, 6, 6, 6],
  uptimeLast5EpochsPct: 99.2,
  jito: true,
  status: "healthy"
};

// --- Simple sparkline drawer ---
function drawSpark(canvas, values) {
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0,0,w,h);

  const min = Math.min(...values);
  const max = Math.max(...values);
  const pad = 4;

  ctx.beginPath();
  values.forEach((v, i) => {
    const x = pad + (i*(w-2*pad))/(values.length-1);
    const y = h - pad - ((v - min) / ((max - min) || 1)) * (h - 2*pad);
    i === 0 ? ctx.moveTo(x,y) : ctx.lineTo(x,y);
  });
  ctx.lineWidth = 2;
  ctx.strokeStyle = "#8bd5ff";
  ctx.stroke();
}

// --- Live data via Solana JSON-RPC (no key needed; public endpoint) ---
async function fetchLive() {
  const rpc = "https://api.mainnet-beta.solana.com";
  const body = {
    jsonrpc: "2.0",
    id: 1,
    method: "getVoteAccounts",
    params: [{ commitment: "finalized" }]
  };

  const res = await fetch(rpc, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  const json = await res.json();
  if (!json.result) throw new Error("RPC response missing result");

  const all = [
    ...(json.result.current || []),
    ...(json.result.delinquent || [])
  ];
  const me = all.find(v => v.votePubkey === VALIDATOR.voteKey);

  if (!me) {
    return {
      commissionHistory: Array(10).fill(0),
      uptimeLast5EpochsPct: 0,
      jito: false,
      status: "not found"
    };
  }

  const commission = me.commission;
  const isDelinquent = (json.result.delinquent || []).some(
    v => v.votePubkey === me.votePubkey
  );
  const status = isDelinquent ? "delinquent" : "healthy";

  let uptimePct = 0;
  try {
    const credits = me.epochCredits || [];
    const last6 = credits.slice(-6);
    const deltas = [];
    for (let i = 1; i < last6.length; i++) {
      const delta = Math.max(0, last6[i][1] - last6[i - 1][1]);
      deltas.push(delta);
    }
    const window = deltas.slice(-5);
    const maxDelta = Math.max(...window, 1);
    const avgRel =
      window.reduce((a, b) => a + b / maxDelta, 0) / window.length;
    uptimePct = Math.round(avgRel * 10000) / 100;
  } catch (e) {
    uptimePct = 0;
  }

  return {
    commissionHistory: Array(10).fill(commission),
    uptimeLast5EpochsPct: uptimePct,
    jito: false,
    status
  };
}

async function main() {
  const data = USE_LIVE ? await fetchLive() : mock;

  // Trust card
  document.getElementById('validator-name').textContent = `Validator: ${VALIDATOR.name}`;
  const jito = document.getElementById('jito-badge');
  jito.textContent = `Jito: ${data.jito ? "ON" : "OFF"}`;
  jito.classList.add(data.jito ? "ok" : "warn");

  document.getElementById('commission').textContent =
    `${data.commissionHistory.at(-1)}%`;
  document.getElementById('uptime').textContent =
    `${data.uptimeLast5EpochsPct.toFixed(2)}%`;
  const statusEl = document.getElementById('status');
  statusEl.textContent = data.status;
  statusEl.classList.add(data.status === "healthy" ? "ok" : "warn");

  // Sparkline
  const spark = document.getElementById('spark');
  drawSpark(spark, data.commissionHistory);
  document.getElementById('spark-label').textContent =
    `Min ${Math.min(...data.commissionHistory)}% • Max ${Math.max(...data.commissionHistory)}% • Latest ${data.commissionHistory.at(-1)}%`;
}

main();
