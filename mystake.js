const THEME_KEY = "vtd-theme";

function apiBase() {
  const h = window.location.hostname;
  if (h === "localhost" || h === "127.0.0.1") return "";
  if (h.includes("validator-transparency-dashboard")) return "";
  return "https://validator-transparency-dashboard.vercel.app";
}

const MY_STAKE_API = `${apiBase()}/api/my-stake`;
const PUBKEY_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

function $(id) {
  return document.getElementById(id);
}

function shortKey(k) {
  if (!k) return "–";
  return k.length > 12 ? `${k.slice(0, 4)}…${k.slice(-4)}` : k;
}

function fmtSol(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return "–";
  if (v === 0) return "0";
  if (Math.abs(v) >= 1) return v.toFixed(4);
  return v.toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
}

function applyTheme(theme) {
  const t = theme === "dark" ? "dark" : "light";
  document.documentElement.setAttribute("data-theme", t);
  const label = $("theme-toggle-label");
  const btn = $("theme-toggle");
  if (label) label.textContent = t === "dark" ? "Light" : "Dark";
  if (btn) {
    btn.setAttribute("aria-pressed", t === "dark" ? "true" : "false");
    btn.setAttribute(
      "aria-label",
      t === "dark" ? "Switch to light theme" : "Switch to dark theme"
    );
  }
  try {
    localStorage.setItem(THEME_KEY, t);
  } catch {
    /* ignore */
  }
}

function currentTheme() {
  return document.documentElement.getAttribute("data-theme") === "dark"
    ? "dark"
    : "light";
}

function getInjected(name) {
  if (name === "phantom") {
    return window.phantom?.solana || window.solana;
  }
  if (name === "solflare") {
    return window.solflare || window.solana?.isSolflare ? window.solana : null;
  }
  return null;
}

async function connectProvider(name) {
  const provider = getInjected(name);
  if (!provider?.connect) {
    throw new Error(
      name === "phantom"
        ? "Phantom is not installed in this browser."
        : "Solflare is not installed in this browser."
    );
  }
  const res = await provider.connect();
  const key =
    res?.publicKey?.toBase58?.() ||
    provider.publicKey?.toBase58?.() ||
    provider.publicKey?.toString?.();
  if (!key || !PUBKEY_RE.test(String(key))) {
    throw new Error("Wallet connected but no public key was returned.");
  }
  return String(key);
}

function setError(text) {
  const el = $("error-line");
  if (!el) return;
  if (!text) {
    el.classList.add("hidden");
    el.textContent = "";
    return;
  }
  el.textContent = text;
  el.classList.remove("hidden");
}

function setStatus(text) {
  const el = $("status-line");
  if (el) el.textContent = text || "";
}

function renderVerdict(v) {
  const card = $("verdict-card");
  if (!card || !v) {
    card?.classList.add("hidden");
    return;
  }
  card.classList.remove("hidden", "ok", "caution", "wait");
  card.classList.add(v.tone === "ok" ? "ok" : v.tone === "caution" ? "caution" : "wait");
  $("verdict-kicker").textContent =
    v.tone === "ok" ? "You do not need to act" : v.tone === "caution" ? "Needs a look" : "No stake found";
  $("verdict-headline").textContent = v.headline || "";
  $("verdict-body").textContent = v.body || "";
  $("verdict-next").textContent = v.next || "";
}

function profileHref(vote) {
  const u = new URL("./index.html", window.location.href);
  u.searchParams.set("vote", vote);
  return u.pathname + u.search;
}

function renderAccounts(data) {
  const card = $("accounts-card");
  const body = $("accounts-body");
  const note = $("accounts-note");
  if (!card || !body) return;
  const rows = data?.accounts || [];
  if (!rows.length) {
    card.classList.add("hidden");
    return;
  }
  card.classList.remove("hidden");
  body.innerHTML = "";
  for (const acc of rows) {
    const tr = document.createElement("tr");
    const last = acc.rewards?.[0];
    const name = acc.validatorName || (acc.vote ? shortKey(acc.vote) : "Not delegated");
    const statusBits = [acc.status];
    if (acc.validator?.status === "delinquent") statusBits.push("validator down");
    if (Number.isFinite(acc.validator?.commission)) {
      statusBits.push(`${acc.validator.commission}% fee`);
    }

    const tdKey = document.createElement("td");
    tdKey.className = "mono";
    tdKey.textContent = shortKey(acc.pubkey);

    const tdVote = document.createElement("td");
    if (acc.vote) {
      const a = document.createElement("a");
      a.href = profileHref(acc.vote);
      a.textContent = name;
      tdVote.appendChild(a);
    } else {
      tdVote.textContent = name;
    }

    const tdStatus = document.createElement("td");
    const pill = document.createElement("span");
    pill.className = `pill${acc.validator?.status === "delinquent" ? " down" : ""}`;
    pill.textContent = statusBits.join(" · ");
    tdStatus.appendChild(pill);

    const tdDel = document.createElement("td");
    tdDel.className = "mono";
    tdDel.textContent = fmtSol(acc.delegatedSol);

    const tdLast = document.createElement("td");
    tdLast.className = "mono";
    tdLast.textContent = last ? `+${fmtSol(last.amountSol)}` : "–";

    const tdIdle = document.createElement("td");
    tdIdle.className = "mono";
    tdIdle.textContent = fmtSol(acc.idleMevSol);

    tr.append(tdKey, tdVote, tdStatus, tdDel, tdLast, tdIdle);
    body.appendChild(tr);
  }
  const parts = [`Epoch ${data.currentEpoch} is in progress.`];
  if (data.truncated) {
    parts.push(`Showing ${data.shown} of ${data.accountCount} stake accounts.`);
  }
  if (note) note.textContent = parts.join(" ");
}

async function loadWallet(wallet) {
  setError("");
  setStatus("Loading your stake…");
  $("verdict-card")?.classList.add("hidden");
  $("accounts-card")?.classList.add("hidden");
  try {
    const res = await fetch(
      `${MY_STAKE_API}?wallet=${encodeURIComponent(wallet)}`
    );
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.ok) {
      throw new Error(json.error || `Lookup failed (${res.status})`);
    }
    setStatus(
      json.accountCount
        ? `Found ${json.accountCount} stake account${json.accountCount === 1 ? "" : "s"}.`
        : "Lookup finished."
    );
    renderVerdict(json.verdict);
    renderAccounts(json);
  } catch (err) {
    setStatus("");
    setError(err.message || "Could not load this wallet.");
  }
}

function showConnected(wallet) {
  const line = $("connected-wallet");
  const disc = $("btn-disconnect");
  if (line) line.textContent = wallet ? `Using ${wallet}` : "";
  if (disc) disc.classList.toggle("hidden", !wallet);
  $("wallet-input").value = wallet || $("wallet-input").value;
}

async function onConnect(name) {
  setError("");
  setStatus("Connecting…");
  try {
    const wallet = await connectProvider(name);
    showConnected(wallet);
    await loadWallet(wallet);
  } catch (err) {
    setStatus("");
    setError(err.message || "Connect failed.");
  }
}

function boot() {
  applyTheme(
    (() => {
      try {
        const t = localStorage.getItem(THEME_KEY);
        if (t === "light" || t === "dark") return t;
      } catch {
        /* ignore */
      }
      return currentTheme();
    })()
  );

  $("theme-toggle")?.addEventListener("click", () => {
    applyTheme(currentTheme() === "dark" ? "light" : "dark");
  });
  $("btn-phantom")?.addEventListener("click", () => onConnect("phantom"));
  $("btn-solflare")?.addEventListener("click", () => onConnect("solflare"));
  $("btn-disconnect")?.addEventListener("click", () => {
    showConnected("");
    setStatus("");
    $("verdict-card")?.classList.add("hidden");
    $("accounts-card")?.classList.add("hidden");
  });
  $("btn-lookup")?.addEventListener("click", () => {
    const wallet = String($("wallet-input")?.value || "").trim();
    if (!PUBKEY_RE.test(wallet)) {
      setError("That does not look like a Solana address.");
      return;
    }
    showConnected(wallet);
    loadWallet(wallet);
  });
  $("wallet-input")?.addEventListener("keydown", e => {
    if (e.key === "Enter") $("btn-lookup")?.click();
  });

  const params = new URLSearchParams(window.location.search);
  const preview = params.get("preview");
  const local =
    window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1";
  if (local && (preview === "ok" || preview === "caution")) {
    showConnected("DemoWallet111111111111111111111111111111111");
    setStatus("Local preview – not live chain data.");
    renderVerdict(
      preview === "caution"
        ? {
            tone: "caution",
            headline: "Something needs a look",
            body: "AndrewInUA is currently missing votes (delinquent). Rewards pause until it catches up.",
            next: "Open the validator page from a row below if you want the long-term history."
          }
        : {
            tone: "ok",
            headline: "Last finished epoch: +0.4120 SOL",
            body: "AndrewInUA looks fine in the snapshots we store. Commission is 5%. You do not need to do anything.",
            next: "Come back after the next epoch, or save this page."
          }
    );
    renderAccounts({
      currentEpoch: 842,
      accountCount: 1,
      shown: 1,
      truncated: false,
      accounts: [
        {
          pubkey: "Stake11111111111111111111111111111111111111",
          vote: "Vote111111111111111111111111111111111111111",
          validatorName: "AndrewInUA",
          status: "active",
          delegatedSol: 128.5,
          idleMevSol: preview === "caution" ? 0.08 : 0,
          validator: {
            status: preview === "caution" ? "delinquent" : "ok",
            commission: 5
          },
          rewards: [{ amountSol: preview === "caution" ? 0 : 0.412 }]
        }
      ]
    });
    return;
  }

  const q = params.get("wallet");
  if (q && PUBKEY_RE.test(q.trim())) {
    $("wallet-input").value = q.trim();
    showConnected(q.trim());
    loadWallet(q.trim());
  }
}

boot();
