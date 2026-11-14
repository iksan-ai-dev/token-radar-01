// farm.js — farm-plan generator for the token radar.
// Shared by main.ts (which writes board.json) and by the dashboard page
// (which renders the same steps in the detail view), so the board and the
// page can never disagree about a protocol's plan. Pure functions: no DOM,
// no network, no clock. Loaded as a classic script in the page and as a
// CommonJS module from main.ts.
//
// Every plan has five steps: setup, three protocol-specific actions, and
// a safety step. Every step names a concrete action, what it costs and
// how long it takes. Gas figures are the builder's November 2026 estimates
// per chain, stated as estimates, not snapshot data. Nothing here promises
// an airdrop: the steps position a reader for one, they never guarantee it.

// Estimated gas cost of one ordinary transaction on each chain, Nov 2026.
var GAS = {
  "Ethereum": "$3-$15", "Arbitrum": "$0.10-$0.50", "Base": "$0.05-$0.30",
  "Optimism": "$0.10-$0.50", "Solana": "~$0.01", "Binance": "$0.10-$0.50",
  "Polygon": "$0.05-$0.30", "Avalanche": "$0.20-$1.00", "Tron": "$0.50-$2.00",
  "Bitcoin": "$1-$5", "Linea": "$0.05-$0.30", "Blast": "$0.05-$0.30",
  "zkSync Era": "$0.10-$0.50", "Scroll": "$0.10-$0.50", "Mantle": "$0.05-$0.30",
  "Sui": "~$0.01", "Aptos": "~$0.01", "Sei": "~$0.01",
  "Berachain": "$0.05-$0.30", "Hyperliquid L1": "~$0.01", "Monad": "~$0.01"
};
var GAS_DEFAULT = "$0.50-$2.00";

// Working capital a reader should expect to put to work.
var CAPITAL = "$100-$500";

function gasFor(chain) { return GAS[chain] || GAS_DEFAULT; }
function chainOf(row) { return (row.chains && row.chains.length > 0) ? row.chains[0] : "Ethereum"; }
function money(n) {
  if (n >= 1000000000) return "$" + (n / 1000000000).toFixed(2) + "B";
  if (n >= 1000000) return "$" + (n / 1000000).toFixed(0) + "M";
  return "$" + Math.round(n).toLocaleString("en-US");
}

// Step 1 (shared) and step 5 (shared); the middle three steps vary by family.
var SETUP = "Set up a wallet funded on {c} with {k} working capital; keep gas aside, about {g} per transaction, and allow 30-60 minutes for setup.";
var SAFETY = "Never share a seed phrase and only use {n}'s official domain; log every transaction and date, and watch {n}'s own announcements for any snapshot or claim window.";

// The action family a category belongs to. Families decide the verbs of
// the plan; the protocol's own name, chain and TVL fill in the specifics.
var FAMILY = {
  "Dexs": "dex", "Derivatives": "dex", "Basis Trading": "dex",
  "Options": "dex", "Leveraged Farming": "dex", "Synthetics": "dex",
  "Interest Rate Derivatives": "dex",
  "Lending": "lend", "CDP": "lend", "Uncollateralized Lending": "lend",
  "Collateral Management": "lend", "Collateral Markets": "lend",
  "CDP Manager": "lend",
  "Yield": "yield", "Yield Aggregator": "yield", "Farm": "yield",
  "Restaking": "yield", "Liquid Restaking": "yield", "Staking Pool": "yield",
  "Token Locker": "yield",
  "RWA": "rwa", "Stablecoin Issuer": "rwa", "Dual-Token Stablecoin": "rwa",
  "Stablecoin Wrapper": "rwa", "Reserve Currency": "rwa",
  "Algo-Stables": "rwa",
  "Risk Curators": "vault", "Onchain Capital Allocator": "vault",
  "Indexes": "vault", "Liquidity Manager": "vault",
  "Chain": "chain",
  "Prediction Market": "market",
  "Payments": "pay", "Crypto Card Issuer": "pay",
  "Insurance": "cover",
  "Governance Incentives": "gov",
  "Launchpad": "launch",
  "NFT Marketplace": "nft",
  "Privacy": "privacy",
  "Decentralized AI": "ai", "AI Agents": "ai",
  "DOR": "generic"
};

function familyOf(category) { return FAMILY[category] || "generic"; }

// The three middle steps per family. {n} name, {c} chain, {g} gas,
// {k} capital, {t} TVL. Built by string replacement, so the page and
// board.json always print the same words.
var STEPS = {
  dex: [
    "Swap a small amount through {n} on {c} (start near $25-$50) to open a real trading history; expect about {g} in gas per swap.",
    "Add liquidity to {n}'s main pool on {c} and leave it in place for at least 4 weeks; a $100-$250 position is enough to register.",
    "Repeat a swap 1-2 times a week for 6-8 weeks with varied sizes and directions instead of one large trade; budget about {g} per week in gas, then try a second {n} feature (limit order, routing or a second pool) once."
  ],
  lend: [
    "Supply a stablecoin to {n} on {c} (start near $100) so the position earns and is recorded; expect about {g} in gas to supply.",
    "Borrow a small amount against the supply, keeping the health factor above 2 at all times, and hold both sides of the position for at least 6 weeks.",
    "Repay part of the borrow and re-supply once mid-way through the period; one genuine cycle beats a single parked deposit, and costs about {g} per action."
  ],
  yield: [
    "Deposit {k} into {n}'s main vault or strategy on {c} and leave it through one full points season; expect about {g} in gas to deposit.",
    "Compound or re-stake the rewards back into {n} every 1-2 weeks so the position grows from activity, not from a single deposit; budget about {g} per claim.",
    "Try a second {n} strategy or vault with a smaller slice (about $50) so the record shows breadth, not just one deposit; hold it for the same 6-8 weeks."
  ],
  rwa: [
    "Mint or buy a small position in {n}'s asset on {c} (start near $100) and hold it; expect about {g} in gas for the mint or purchase.",
    "Use the position more than once: redeem and re-enter a small part mid-way, keeping the collateral ratio the protocol asks for; budget about {g} per action.",
    "Hold the remaining position for 6-8 weeks of continuous exposure instead of a one-day park; check the asset's backing and redemption terms first."
  ],
  vault: [
    "Deposit {k} into a {n} curated vault on {c} and read which strategies it runs before depositing; expect about {g} in gas to deposit.",
    "Leave the deposit in place for 6-8 weeks so the record shows duration, and check the vault's rebalances weekly (5 minutes, no transaction needed).",
    "Add a second, smaller deposit (about $50) in a different {n} vault to show breadth across curators; keep the total working capital near {k}."
  ],
  chain: [
    "Bridge {k} onto {c} and make a first real transaction (a swap or a transfer) so the address is active on the chain; expect about {g} in gas.",
    "Transact on {c} 1-2 times a week for 6-8 weeks with varied amounts and different apps on the chain, not the same action on repeat; budget about {g} per week.",
    "Try one native {c} feature (staking, a native app or a governance vote) with a small amount to broaden the on-chain record."
  ],
  market: [
    "Trade a small position (about $10-$25) on a {n} market on {c} that you have actually read, rather than the largest market; expect about {g} in gas.",
    "Trade 1-2 markets a week for 6-8 weeks across different topics, closing positions instead of leaving them all open; budget about {g} per week.",
    "Provide liquidity or add to a market you follow closely with a small slice (about $50) to show a second kind of participation."
  ],
  pay: [
    "Make a first real payment through {n} on {c} (about $20-$50) so the address has a payment history; expect about {g} in gas.",
    "Use {n} for ordinary payments 1-2 times a week for 6-8 weeks, in varied amounts, instead of a single large transfer; budget about {g} per week.",
    "Try a second {n} feature (a different asset, a card top-up or a recurring payment) once with a small amount."
  ],
  cover: [
    "Buy a small cover policy from {n} on {c} (about $50-$100 of cover) for a risk you actually hold; expect about {g} in gas.",
    "Hold the cover for its full term (typically 4-8 weeks) and renew or extend it once, so the record shows an ongoing policy, not a one-day purchase.",
    "Try a second {n} cover type with a smaller amount to show breadth across the protocol's products."
  ],
  gov: [
    "Hold a small position in {n}'s ecosystem on {c} (about $100) and delegate or vote on one live proposal; expect about {g} in gas to vote.",
    "Vote on 2-3 proposals over 6-8 weeks instead of a single vote, and read each proposal before voting; budget about {g} per vote.",
    "Join one community discussion or forum thread for {n} with a substantive comment, so participation is visible beyond the vote itself."
  ],
  launch: [
    "Join one {n} launch on {c} with a small allocation (about $50-$100) after reading its terms; expect about {g} in gas to participate.",
    "Hold the allocation through the launch's lock or vesting period instead of selling at the first minute; check the unlock schedule first.",
    "Join a second, different {n} launch a few weeks later with a smaller amount, so the record shows repeat participation."
  ],
  nft: [
    "Buy one low-priced item on {n} on {c} (about $25-$50) that you actually want to hold; expect about {g} in gas.",
    "List or trade one item a few weeks later instead of flipping the same day, so the record shows a real collector, not a wash pattern; budget about {g} per trade.",
    "Use a second {n} feature (an offer, a collection bid or a mint) once with a small amount."
  ],
  privacy: [
    "Make a first private transaction through {n} on {c} with a small amount (about $25-$50); expect about {g} in gas.",
    "Use {n} 1-2 times a week for 6-8 weeks for ordinary transfers, keeping amounts varied; budget about {g} per week.",
    "Try a second {n} privacy feature (a shielded pool or a private transfer to a second address you control) once."
  ],
  ai: [
    "Run one real paid task on {n} on {c} (about $10-$25 of usage) so the address has genuine usage; expect about {g} in gas.",
    "Use {n} 1-2 times a week for 6-8 weeks for tasks you actually need, varying the requests; budget about {g} per week in gas plus usage fees.",
    "Try a second {n} capability (a different model, agent or dataset) once with a small amount."
  ],
  generic: [
    "Use {n}'s main feature on {c} once with a small amount (about $50) so the address has a real first interaction; expect about {g} in gas.",
    "Repeat that core action 1-2 times a week for 6-8 weeks with varied amounts instead of a single large interaction; budget about {g} per week.",
    "Try a second {n} feature with a smaller amount (about $25) to show breadth across what the protocol offers."
  ]
};

function farmStepsFor(row) {
  var chain = chainOf(row);
  var fam = familyOf(row.category);
  var templates = [SETUP].concat(STEPS[fam] || STEPS.generic, [SAFETY]);
  var subs = {
    "{n}": row.name,
    "{c}": chain,
    "{g}": gasFor(chain),
    "{k}": CAPITAL,
    "{t}": money(row.tvl_usd || 0)
  };
  return templates.map(function (t) {
    var s = t;
    for (var k in subs) s = s.split(k).join(subs[k]);
    return s;
  });
}

var api = { GAS: GAS, gasFor: gasFor, familyOf: familyOf, farmStepsFor: farmStepsFor, money: money };

// Classic-script global for the dashboard page.
if (typeof globalThis !== "undefined") globalThis.RadarFarm = api;
// CommonJS export for main.ts.
if (typeof module !== "undefined" && module.exports) module.exports = api;
