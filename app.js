/**
 * Validator Transparency Dashboard – app.js
 *
 * Key fix in this version:
 * ✅ Share links work for other validators (supports ?vote= AND #?vote= for GitHub Pages).
 * ✅ Share link box always shows the full URL.
 * ✅ If user passes an identity pubkey by mistake (not vote pubkey), we show "not found"
 *    instead of silently showing AndrewInUA.
 */

// ──────────────────────────────────────────────
// CONFIG
// ──────────────────────────────────────────────
const USE_LIVE = true;

// Default validator (used only when URL has no overrides)
const VALIDATOR = {
  name: "AndrewInUA",
  voteKey: "3QPGLackJy5LKctYYoPGmA4P8ncyE197jdxr1zP2ho8K"
};

// ⚠️ Important: do NOT keep private API keys in app.js long-term.
// Your Helius key is currently public if it’s in this file on GitHub Pages.
const HELIUS_RPC = "https://mainnet.helius-rpc.com/?api-key=8c0db429-5430-4151-95f3-7487584d0a36";

// Your Vercel Jito proxy (api/jito.js).
const JITO_PROXY = "https://validator-transparency-dashboard.vercel.app/api/jito";

// ──────────────────────────────────────────────
// URL helpers (supports GitHub Pages hash links)
// ──────────────────────────────────────────────
function readParamsFromUrl() {
  // Normal: https://site/?vote=...&name=...
  const normal = new URLSearchParams(window.location.search);

  // GitHub Pages often: https://site/#?vote=...&name=...
  // or: https://site/#/something?vote=...
  const hash = window.location.hash || "";
  const qIndex = hash.indexOf("?");
  const hashQuery = qIndex >= 0 ? hash.slice(qIndex + 1) : "";
  const fromHash = new URLSearchParams(hashQuery);

  // Prefer normal querystring, fallback to hash querystring
  const vote = (normal.get("vote") || fromHash.get("vote") || "").trim();
  const name = (normal.get("name") || fromHash.get("name") || "").trim();

  return { vote, name };
}

function applyUrlOverrides() {
  const { vote, name } = readParamsFromUrl();
  if (vote) VALIDATOR.voteKey = vote;
  if (name) VALIDATOR.name = name;
}

function buildShareUrl() {
  // Always produce canonical share link using "?vote=" (not hash)
  const url = new URL(window.location.href);
  url.hash = ""; // remove hash, so link is clean
  url.searchParams.set("vote", VALIDATOR.voteKey);
  if (VALIDATOR.name) url.searchParams.set("name", VALIDATOR.name);
  return url.toString();
}

// ──────────────────────────────────────────────
// MOCK DATA (only if USE_LIVE === false)
// ──────────────────────────────────────────────
const MOCK_DATA = {
  commissionHistory: [8, 8, 8, 7, 7, 7, 6, 6, 6, 6],
  uptimeLast5EpochsPct: 99.2,
  jito: true,
  status: "healthy"
};

// ──────────────────────────────────────────────
// UI helpers
// ──────────────────────────────────────────────
function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function setBadge(id, text, ok) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = text;
  el.classList.remove("ok", "warn");
  el.classList.add(ok ? "ok" : "warn");
}

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

function renderShareBlock() {
  const input = document.getElementById("share-link");
  const btn = document.getElementById("copy-share");
  const status = document.getElementById("copy-status");

  if (!input || !btn) return;

  input.value = buildShareUrl();

  btn.onclick = async () => {
    try {
      await navigator.clipboard.writeText(input.value);
      if (status) status.textContent = "Copied ✅";
      setTimeout(() => { if (status) status.textContent = ""; }, 1500);
    } catch {
      // fallback
      input.focus();
      input.select();
      document.execCommand("copy");
      if (status) status.textContent = "Copied ✅";
      setTimeout(() => { if (status) status.textContent = ""; }, 1500);
    }
  };
}

// ──────────────────────────────────────────────
// Jito via proxy
// ──────────────────────────────────────────────
async function fetchJitoStatus(voteKey) {
  if (!JITO_PROXY) return false;

  try {
    const url = `${JITO_PROXY}?vote=${encodeURIComponent(voteKey)}`;
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`Jito proxy HTTP ${res.status}`);
    const json = await res.json();
    return !!json.jito;
  } catch (err) {
    console.warn("Jito check failed:", err);
    return false;
  }
}

// ──────────────────────────────────────────────
// LIVE DATA
// ──────────────────────────────────────────────
async function fetchLive() {
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
    found: false
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

      const me = all.find((v) => v.votePubkey === VALIDATOR.voteKey);

      if (!me) {
        // IMPORTANT: do not fall back silently to default validator here
        return { ...EMPTY, status: "not found", found: false };
      }

      const commission = Number(me.commission ?? 0);
      const isDelinquent = delinquent.some((v) => v.votePubkey === me.votePubkey);
      const status = isDelinquent ? "delinquent" : "healthy";

      // "Epoch performance (proxy)" based on epochCredits deltas (NOT true uptime)
      let uptimePct = 0;
      try {
        const credits = me.epochCredits || [];
        const last6 = credits.slice(-6); // last 6 points => 5 deltas
        const deltas = [];

        for (let i = 1; i < last6.length; i++) {
          const prevCredits = last6[i - 1]?.[1] ?? 0;
          const curCredits = last6[i]?.[1] ?? 0;
          deltas.push(Math.max(0, curCredits - prevCredits));
        }

        const window = deltas.slice(-5);
        const maxDelta = Math.max(...window, 1);

        // Average of (delta / maxDelta) over last 5 => 0..1 => 0..100%
        const avgRelative = window.length
          ? window.reduce((sum, d) => sum + d / maxDelta, 0) / window.length
          : 0;

        uptimePct = Math.round(avgRelative * 10000) / 100;
      } catch (err) {
        console.warn("Epoch performance calc error:", err);
        uptimePct = 0;
      }

      const jito = await fetchJitoStatus(VALIDATOR.voteKey);

      return {
        commissionHistory: Array(10).fill(commission),
        uptimeLast5EpochsPct: uptimePct,
        jito,
        status,
        found: true
      };
    } catch (err) {
      console.warn("RPC failed:", rpc, err?.message || err);
    }
  }

  return EMPTY;
}

// ──────────────────────────────────────────────
// MAIN
// ──────────────────────────────────────────────
async function main() {
  applyUrlOverrides();

  // Render header bits immediately
const short = (s) => (s && s.length > 10 ? `${s.slice(0,4)}…${s.slice(-4)}` : s || "—");
const displayName = VALIDATOR.name?.trim() ? VALIDATOR.name.trim() : short(VALIDATOR.voteKey);
setText("validator-name", `Validator: ${displayName}`);
  renderShareBlock();

  let data = USE_LIVE ? await fetchLive() : MOCK_DATA;

  // If not found, show it clearly (this is the core “share link shows my validator” fix)
  if (data.status === "not found") {
    setBadge("jito-badge", "Jito: —", false);
    setText("commission", "—%");
    setText("uptime", "—%");
    setBadge("status", "not found", false);
    setText("last-updated", "Last updated: —");

    const sparkCanvas = document.getElementById("spark");
    if (sparkCanvas) drawSpark(sparkCanvas, Array(10).fill(0));
    setText("spark-label", "Vote account not found. Make sure you used the VOTE address (votePubkey), not identity.");

    return;
  }

  // Jito badge
  setBadge("jito-badge", `Jito: ${data.jito ? "ON" : "OFF"}`, !!data.jito);

  // Commission / proxy
  const history = data.commissionHistory || [];
  const latestCommission = history.length ? Number(history[history.length - 1]) : 0;
  setText("commission", `${Number.isFinite(latestCommission) ? latestCommission.toFixed(0) : 0}%`);
  setText("uptime", `${Number(data.uptimeLast5EpochsPct || 0).toFixed(2)}%`);

  // Status
  const ok = data.status === "healthy";
  setBadge("status", data.status || "—", ok);

  // Timestamp
  const ts = new Date();
  const fmt = ts.toLocaleString("en-GB", {
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    day: "2-digit", month: "short"
  });
  setText("last-updated", `Last updated: ${fmt}`);

  // Spark
  const sparkCanvas = document.getElementById("spark");
  const series = history.length ? history : Array(10).fill(0);
  if (sparkCanvas) drawSpark(sparkCanvas, series);

  const min = Math.min(...series);
  const max = Math.max(...series);
  setText(
    "spark-label",
    `Min ${min}% • Max ${max}% • Latest ${Number.isFinite(latestCommission) ? latestCommission.toFixed(0) : 0}%`
  );

  // Keep share link correct even if name/vote came from hash query
  renderShareBlock();
}

main();
