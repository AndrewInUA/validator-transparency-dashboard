import { createClient } from "@supabase/supabase-js";

const STAKE_PROGRAM = "Stake11111111111111111111111111111111111111";
const LAMPORTS_PER_SOL = 1_000_000_000;
const PUBKEY_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const MAX_ACCOUNTS = 40;
const REWARD_EPOCHS = 8;
const STAKER_OFFSET = 12;
const WITHDRAWER_OFFSET = 44;

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function rpcList() {
  const solanaRpc = String(process.env.SOLANA_RPC || "").trim();
  const heliusKey = String(process.env.HELIUS_API_KEY || "").trim();
  return [
    solanaRpc ? { url: solanaRpc, source: "solana_rpc_env" } : null,
    heliusKey
      ? {
          url: `https://mainnet.helius-rpc.com/?api-key=${heliusKey}`,
          source: "helius_env"
        }
      : null,
    { url: "https://api.mainnet-beta.solana.com", source: "solana_public" }
  ].filter(Boolean);
}

async function rpcCall(method, params) {
  let lastErr = null;
  for (const rpc of rpcList()) {
    try {
      const rpcRes = await fetch(rpc.url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params })
      });
      if (!rpcRes.ok) throw new Error(`RPC HTTP ${rpcRes.status}`);
      const json = await rpcRes.json();
      if (json?.error) {
        throw new Error(json.error.message || "RPC returned error");
      }
      return { result: json.result, source: rpc.source };
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error("All RPC providers failed");
}

function lamportsToSol(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  return v / LAMPORTS_PER_SOL;
}

function fmtSol(n, digits = 4) {
  if (!Number.isFinite(n)) return "0";
  if (Math.abs(n) >= 1) return n.toFixed(Math.min(4, digits));
  if (Math.abs(n) === 0) return "0";
  return n.toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
}

function stakeState(parsed, currentEpoch) {
  const type = parsed?.type;
  if (type === "uninitialized") return "inactive";
  const del = parsed?.info?.stake?.delegation;
  if (!del) return "inactive";
  const act = Number(del.activationEpoch);
  const deact = Number(del.deactivationEpoch);
  const epoch = Number(currentEpoch);
  if (!Number.isFinite(epoch)) return "unknown";
  if (Number.isFinite(deact) && deact < epoch) return "inactive";
  if (Number.isFinite(deact) && deact === epoch) return "deactivating";
  if (Number.isFinite(act) && act >= epoch) return "activating";
  return "active";
}

async function fetchStakeAccounts(wallet) {
  const byPubkey = new Map();

  async function pull(offset) {
    const { result, source } = await rpcCall("getProgramAccounts", [
      STAKE_PROGRAM,
      {
        encoding: "jsonParsed",
        commitment: "confirmed",
        filters: [{ memcmp: { offset, bytes: wallet } }]
      }
    ]);
    const list = Array.isArray(result) ? result : [];
    for (const item of list) {
      const pubkey = item?.pubkey;
      if (pubkey && !byPubkey.has(pubkey)) byPubkey.set(pubkey, item);
    }
    return source;
  }

  let source = "unknown";
  let lastErr = null;
  for (const offset of [WITHDRAWER_OFFSET, STAKER_OFFSET]) {
    try {
      source = (await pull(offset)) || source;
    } catch (err) {
      lastErr = err;
    }
  }
  if (byPubkey.size === 0 && lastErr) throw lastErr;
  return { accounts: [...byPubkey.entries()], source };
}

function parseAccount(pubkey, item, currentEpoch) {
  const parsed = item?.account?.data?.parsed;
  const info = parsed?.info || {};
  const meta = info.meta || {};
  const stakeInfo = info.stake || {};
  const del = stakeInfo.delegation || null;
  const lamports = Number(item?.account?.lamports || 0);
  const delegated = Number(del?.stake || 0);
  const rent = Number(meta.rentExemptReserve || 0);
  const idleLamports = Math.max(0, lamports - delegated - rent);
  const vote = del?.voter ? String(del.voter) : null;
  const status = stakeState(parsed, currentEpoch);

  return {
    pubkey,
    vote,
    status,
    lamports,
    sol: lamportsToSol(lamports),
    delegatedSol: lamportsToSol(delegated),
    idleMevSol: lamportsToSol(idleLamports),
    staker: meta.authorized?.staker || null,
    withdrawer: meta.authorized?.withdrawer || null,
    activationEpoch: del ? Number(del.activationEpoch) : null,
    deactivationEpoch: del ? Number(del.deactivationEpoch) : null
  };
}

async function fetchRewards(pubkeys, currentEpoch) {
  const epochs = [];
  for (let i = 1; i <= REWARD_EPOCHS; i += 1) {
    const epoch = currentEpoch - i;
    if (epoch < 0) break;
    epochs.push(epoch);
  }

  const byAccount = Object.fromEntries(pubkeys.map(p => [p, []]));

  for (const epoch of epochs) {
    try {
      const { result } = await rpcCall("getInflationReward", [
        pubkeys,
        { epoch, commitment: "finalized" }
      ]);
      const rows = Array.isArray(result) ? result : [];
      rows.forEach((row, idx) => {
        const pk = pubkeys[idx];
        if (!pk || !row) return;
        byAccount[pk].push({
          epoch,
          amountSol: lamportsToSol(row.amount),
          commission: Number.isFinite(Number(row.commission))
            ? Number(row.commission)
            : null,
          postBalanceSol: lamportsToSol(row.postBalance)
        });
      });
    } catch {
      /* skip epoch if RPC refuses */
    }
  }

  return byAccount;
}

async function latestSnapshots(supabase, voteKeys) {
  const out = {};
  for (const vote of voteKeys) {
    const { data, error } = await supabase
      .from("validator_snapshots")
      .select("status, commission, uptime, captured_at")
      .eq("vote_key", vote)
      .order("captured_at", { ascending: false })
      .limit(16);

    if (error || !data?.length) {
      out[vote] = null;
      continue;
    }

    const latest = data[0];
    const older = data.find(row => {
      const a = new Date(row.captured_at).getTime();
      const b = new Date(latest.captured_at).getTime();
      return Number.isFinite(a) && Number.isFinite(b) && b - a >= 3 * 86400000;
    });

    const commNow = Number(latest.commission);
    const commThen = older ? Number(older.commission) : null;
    out[vote] = {
      status: latest.status || "unknown",
      commission: Number.isFinite(commNow) ? commNow : null,
      uptime: Number.isFinite(Number(latest.uptime))
        ? Number(latest.uptime)
        : null,
      captured_at: latest.captured_at,
      commissionWas: Number.isFinite(commThen) ? commThen : null,
      commissionChanged:
        Number.isFinite(commNow) &&
        Number.isFinite(commThen) &&
        commNow !== commThen
    };
  }
  return out;
}

async function validatorNames(voteKeys) {
  const names = {};
  await Promise.all(
    voteKeys.slice(0, 12).map(async vote => {
      try {
        const r = await fetch(`https://api.stakewiz.com/validator/${vote}`, {
          headers: { accept: "application/json" }
        });
        if (!r.ok) return;
        const j = await r.json();
        const name = String(j?.name || "").trim();
        if (name) names[vote] = name;
      } catch {
        /* names are optional */
      }
    })
  );
  return names;
}

function shortKey(k) {
  if (!k) return "–";
  return k.length > 12 ? `${k.slice(0, 4)}…${k.slice(-4)}` : k;
}

function buildVerdict(accounts, names) {
  if (!accounts.length) {
    return {
      tone: "wait",
      headline: "No native stake on this wallet",
      body: "We did not find a stake account this address controls. If you only hold a liquid staking token (JitoSOL, mSOL, PSOL), that will not show here – this page is for native stake.",
      next: "If you expected to see a position, check you connected the wallet that actually created the stake."
    };
  }

  const issues = [];
  const notes = [];
  let lastEpochSol = 0;

  for (const acc of accounts) {
    const label = acc.vote
      ? names[acc.vote] || shortKey(acc.vote)
      : "an undelegated account";
    const last = acc.rewards?.[0];
    if (last) lastEpochSol += last.amountSol;

    if (acc.status === "active" && last && last.amountSol === 0) {
      issues.push(
        `${label}: this stake is active but the last finished epoch paid 0 SOL.`
      );
    }
    if (acc.validator?.status === "delinquent") {
      issues.push(
        `${label} is currently missing votes (delinquent). Rewards pause until it catches up.`
      );
    }
    if (acc.validator?.commission === 100) {
      issues.push(
        `${label} is at 100% commission – a stop sign. Delegators keep none of the inflation rewards.`
      );
    }
    if (acc.validator?.commissionChanged) {
      issues.push(
        `${label} changed commission (was ${acc.validator.commissionWas}%, now ${acc.validator.commission}%).`
      );
    }
    if (acc.idleMevSol >= 0.01) {
      notes.push(
        `${fmtSol(acc.idleMevSol)} SOL of spare balance is sitting on ${shortKey(acc.pubkey)} (often Jito tips – not auto-staked).`
      );
    }
  }

  const uniqueVotes = [...new Set(accounts.map(a => a.vote).filter(Boolean))];
  const comms = uniqueVotes
    .map(v => accounts.find(a => a.vote === v)?.validator?.commission)
    .filter(n => Number.isFinite(n));
  const commLine =
    comms.length === 0
      ? null
      : comms.every(c => c === comms[0])
        ? `Commission is ${comms[0]}%.`
        : `Commission differs across your validators (${comms.join("% / ")}%).`;

  if (issues.length) {
    return {
      tone: "caution",
      headline: "Something needs a look",
      body: issues.join(" "),
      next: notes[0] || "Open the validator page from a row below if you want the long-term history.",
      lastEpochSol
    };
  }

  const who =
    uniqueVotes.length === 1
      ? names[uniqueVotes[0]] || shortKey(uniqueVotes[0])
      : `${uniqueVotes.length} validators`;
  const look = uniqueVotes.length === 1 ? "looks" : "look";

  return {
    tone: "ok",
    headline: `Last finished epoch: +${fmtSol(lastEpochSol)} SOL`,
    body: `${who} ${look} fine in the snapshots we store. ${commLine || "We do not have a recent commission reading."} You do not need to do anything.`.replace(
      /\s+/g,
      " "
    ),
    next: notes[0] || "Come back after the next epoch, or save this page.",
    lastEpochSol
  };
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const wallet = String(req.query.wallet || "").trim();
  if (!PUBKEY_RE.test(wallet)) {
    return res.status(400).json({
      ok: false,
      error: "Pass a Solana wallet address as ?wallet="
    });
  }

  try {
    const epochInfo = await rpcCall("getEpochInfo", []);
    const currentEpoch = Number(epochInfo.result?.epoch);
    if (!Number.isFinite(currentEpoch)) {
      throw new Error("Could not read current epoch");
    }

    const { accounts: rawAccounts, source: gpaSource } =
      await fetchStakeAccounts(wallet);

    const sliced = rawAccounts.slice(0, MAX_ACCOUNTS);
    const parsed = sliced.map(([pubkey, item]) =>
      parseAccount(pubkey, item, currentEpoch)
    );

    const pubkeys = parsed.map(a => a.pubkey);
    const rewardMap =
      pubkeys.length > 0 ? await fetchRewards(pubkeys, currentEpoch) : {};

    const voteKeys = [
      ...new Set(parsed.map(a => a.vote).filter(Boolean))
    ];

    let snapshots = {};
    const supabaseUrl = String(process.env.SUPABASE_URL || "").trim();
    const supabaseKey = String(
      process.env.SUPABASE_SERVICE_ROLE_KEY || ""
    ).trim();
    if (supabaseUrl && supabaseKey && voteKeys.length) {
      const supabase = createClient(supabaseUrl, supabaseKey);
      snapshots = await latestSnapshots(supabase, voteKeys);
    }

    const names = voteKeys.length ? await validatorNames(voteKeys) : {};

    const accounts = parsed.map(acc => ({
      ...acc,
      rewards: rewardMap[acc.pubkey] || [],
      validator: acc.vote ? snapshots[acc.vote] || null : null,
      validatorName: acc.vote ? names[acc.vote] || null : null
    }));

    const verdict = buildVerdict(accounts, names);
    const truncated = rawAccounts.length > MAX_ACCOUNTS;

    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({
      ok: true,
      wallet,
      currentEpoch,
      rpc_source: gpaSource,
      truncated,
      accountCount: rawAccounts.length,
      shown: accounts.length,
      verdict,
      accounts
    });
  } catch (e) {
    return res.status(502).json({
      ok: false,
      error: e.message || "Failed to load stake accounts"
    });
  }
}
