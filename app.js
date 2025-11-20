// --- CONFIG ---
const USE_LIVE = false; // change to true when you add API keys and endpoints
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

// --- Live data stub (fill later) ---
async function fetchLive() {
  // Example shape; later replace with real RPC/Helius/Jito calls via your backend or serverless functions.
  return {
    commissionHistory: [8, 8, 8, 8, 7, 7, 7, 7, 6, 6],
    uptimeLast5EpochsPct: 98.9,
    jito: true,
    status: "healthy"
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
