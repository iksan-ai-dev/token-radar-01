// main.ts — Token launch radar for make.fun's token-radar-01.
// Node 22, standard library only. Reads the sealed DefiLlama snapshot at
// /input/snapshot.json (or --input <path>), writes the ranked board to
// /output/board.json, the dashboard's data to /output/dashboard/data.js,
// copies dashboard/ and screenshots/ to /output, and writes
// /output/dossier.json with buildDossier from vendor/makefun-board.ts.
// Output dir is $MAKEFUN_OUTPUT_DIR, else /output. Fully deterministic:
// every number comes from the snapshot, ties break by slug, no clock,
// no randomness — two runs write byte-identical files.
//
// The value model (see METHODOLOGY in the dashboard for the full text):
//   implied = TVL x category multiple x growth x age x breadth x quality
// - category multiple: the median mcap/TVL of the tokened protocols in the
//   same category, computed at runtime from this very snapshot (global
//   median when a category has fewer than 5 tokened comparables), clamped
//   to [0.02, 1.00]. Circulating mcap, not FDV — the value is a
//   circulating-mcap equivalent, and the dashboard says so.
// - growth: 1 + 0.5 * clamp(change_7d / 25, -1, +1); null change_7d -> 1.
// - age: from listed_at vs the snapshot's as_of; mature pre-token
//   protocols (1-4 years) score best, the very young and the very old less.
// - breadth: 1 + 0.08 * ln(chains), capped at 1.25.
// - quality: 0.5 for Risk Curators and Onchain Capital Allocators, whose
//   vaults a token would belong to the underlying strategies, not the
//   curator; 1.0 otherwise. The discount is stated on the dashboard.
// Implied value is capped at $10B and rounded to whole dollars.

import { readFileSync, writeFileSync, mkdirSync, cpSync } from "node:fs";
import { join } from "node:path";
import { buildDossier } from "./vendor/makefun-board.ts";
import farm from "./dashboard/farm.js";

const farmStepsFor = (farm as any).farmStepsFor as (
  row: { name: string; category: string | null; chains: string[]; tvl_usd: number }
) => string[];

// ---- snapshot types (exactly the ten fields the house ships) ----
type Protocol = {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
};

type Snapshot = {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: Protocol[];
  watchlist: string[];
};

// ---- candidate rule (the house's watchlist rule, plus one stated extra) ----
// A launch candidate records no token (gecko_id and symbol both null) and
// is not a wrapped, staked or bridged product of a token that already
// trades: category not in the excluded set, name with no whole word
// wrapped/staked/staking, no trailing version marker, no exchange prefix.
// This entry additionally excludes Cross Chain Bridge, a bridged product
// the house's six categories leave out; the dashboard's methodology says so.
const EXCLUDED_CATEGORIES = new Set([
  "Bridge",
  "Canonical Bridge",
  "Cross Chain Bridge",
  "Liquid Staking",
  "Liquid Restaking",
  "Restaked BTC",
  "CEX",
]);
const EXCHANGE_PREFIX =
  /^(binance|coinbase|bybit|kraken|bitget|okx|bitfinex|gemini|htx|kucoin|crypto\.com|deribit|bitstamp)\b/i;
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;
const VERSION_SUFFIX = /\s(v\d+|v\d+\.\d+|\d+\.\d+)$/i;

function isCandidate(p: Protocol): boolean {
  if (p.gecko_id !== null || p.symbol !== null) return false;
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return false;
  if (WRAPPED_WORD.test(p.name)) return false;
  if (VERSION_SUFFIX.test(p.name)) return false;
  if (EXCHANGE_PREFIX.test(p.name)) return false;
  if (!(p.tvl_usd > 0)) return false;
  return true;
}

// ---- small numeric helpers (all deterministic) ----
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  if (n === 0) return NaN;
  return n % 2 === 1 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
}

function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

function ageYears(listedAt: string | null, asOf: string): number | null {
  if (!listedAt) return null;
  const start = Date.parse(listedAt + "T00:00:00Z");
  const end = Date.parse(asOf + "T00:00:00Z");
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return null;
  return (end - start) / 365.25 / 86400000;
}

function ageFactor(age: number | null): number {
  if (age === null) return 1;
  if (age < 0.5) return 0.85;
  if (age < 1) return 0.95;
  if (age <= 4) return 1 + 0.05 * Math.log2(age);
  return Math.max(0.85, 1.1 - 0.03 * (age - 4));
}

function growthFactor(change7d: number | null): number {
  if (change7d === null || Number.isNaN(change7d)) return 1;
  return 1 + 0.5 * clamp(change7d / 25, -1, 1);
}

function breadthFactor(chains: string[]): number {
  return Math.min(1.25, 1 + 0.08 * Math.log(Math.max(1, chains.length)));
}

function qualityFactor(category: string | null): number {
  if (category === "Risk Curators" || category === "Onchain Capital Allocator") return 0.5;
  return 1;
}

// ---- main ----
function main(): void {
  const argv = process.argv.slice(2);
  let inputPath = "/input/snapshot.json";
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--input" && i + 1 < argv.length) inputPath = argv[++i];
  }
  const outDir = process.env.MAKEFUN_OUTPUT_DIR || "/output";

  const snap = JSON.parse(readFileSync(inputPath, "utf8")) as Snapshot;
  const watchlist = new Set(snap.watchlist);
  const asOf = snap.as_of;

  // Category multiples from the snapshot's own tokened protocols.
  const byCategory = new Map<string, number[]>();
  const allRatios: number[] = [];
  for (const p of snap.protocols) {
    if (p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0) {
      const ratio = p.mcap_usd / p.tvl_usd;
      allRatios.push(ratio);
      const key = p.category ?? "(no category)";
      if (!byCategory.has(key)) byCategory.set(key, []);
      byCategory.get(key)!.push(ratio);
    }
  }
  const globalMultiple = median(allRatios);
  const multiples: Record<string, { median: number; n: number; source: string }> = {};
  for (const [cat, ratios] of [...byCategory.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    if (ratios.length >= 5) {
      multiples[cat] = { median: clamp(median(ratios), 0.02, 1), n: ratios.length, source: "category" };
    } else {
      multiples[cat] = { median: globalMultiple, n: ratios.length, source: "global fallback" };
    }
  }

  // Comparables per category for the dashboard: top 3 by ratio, name + ratio.
  const comparables: Record<string, { name: string; ratio: number }[]> = {};
  for (const [cat] of [...byCategory.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const rows = snap.protocols
      .filter((p) => (p.category ?? "(no category)") === cat && p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0)
      .map((p) => ({ name: p.name, ratio: p.mcap_usd! / p.tvl_usd }))
      .sort((a, b) => b.ratio - a.ratio || (a.name < b.name ? -1 : 1))
      .slice(0, 2);
    comparables[cat] = rows;
  }

  // Score every candidate, then rank by implied value, slug as tie-break.
  const scored = snap.protocols
    .filter(isCandidate)
    .map((p) => {
      const key = p.category ?? "(no category)";
      const mult = multiples[key] ?? { median: globalMultiple, n: 0, source: "global fallback" };
      const age = ageYears(p.listed_at, asOf);
      const growth = growthFactor(p.change_7d);
      const ageF = ageFactor(age);
      const breadth = breadthFactor(p.chains);
      const quality = qualityFactor(p.category);
      const raw = p.tvl_usd * mult.median * growth * ageF * breadth * quality;
      const implied = Math.max(1, Math.min(10_000_000_000, Math.round(raw)));
      return {
        slug: p.slug,
        name: p.name,
        category: p.category,
        chains: p.chains,
        tvl_usd: p.tvl_usd,
        change_7d: p.change_7d,
        listed_at: p.listed_at,
        age_years: age === null ? null : Math.round(age * 100) / 100,
        multiple_used: Math.round(mult.median * 10000) / 10000,
        multiple_n: mult.n,
        multiple_source: mult.source,
        growth_factor: Math.round(growth * 1000) / 1000,
        age_factor: Math.round(ageF * 1000) / 1000,
        breadth_factor: Math.round(breadth * 1000) / 1000,
        quality_factor: quality,
        implied_value_usd: implied,
        tier: watchlist.has(p.slug) ? "Watchlist" : "Below floor",
        farm_steps: farmStepsFor(p),
      };
    })
    .sort((a, b) => b.implied_value_usd - a.implied_value_usd || (a.slug < b.slug ? -1 : 1));

  // The watchlist must be fully covered: assert it, loudly, before writing.
  const rankedSlugs = new Set(scored.map((r) => r.slug));
  const missing = snap.watchlist.filter((s) => !rankedSlugs.has(s));
  if (missing.length > 0) throw new Error("watchlist not covered: " + missing.join(", "));
  if (scored.length < 100) throw new Error("board below 100 rows: " + scored.length);

  const rows = scored.map((r, i) => ({ ...r, rank: i + 1 }));
  // Re-sort rows into rank order for board.json (rank 1 first).
  const boardRows = rows.map((r) => {
    const { rank, ...rest } = r as any;
    return { ...rest, rank };
  });

  // ---- write /output ----
  mkdirSync(outDir, { recursive: true });
  mkdirSync(join(outDir, "dashboard"), { recursive: true });
  mkdirSync(join(outDir, "screenshots"), { recursive: true });

  const board = {
    generated_from: "DefiLlama snapshot " + asOf,
    rows: boardRows,
  };
  writeFileSync(join(outDir, "board.json"), JSON.stringify(board, null, 2) + "\n", "utf8");

  // Compact dashboard data: arrays, short values, no farm steps (the page
  // regenerates them from farm.js, the same code that wrote board.json).
  // tier: 1 = Watchlist, 0 = Below floor. multiple_source: 1 = category,
  // 0 = global fallback.
  const dataRows = boardRows.map((r) => [
    r.rank, r.slug, r.name, r.category, r.chains, r.tvl_usd, r.change_7d,
    r.age_years === null ? null : Math.round(r.age_years * 10) / 10,
    r.multiple_used, r.multiple_n, r.multiple_source === "category" ? 1 : 0,
    Math.round(r.growth_factor * 100) / 100, Math.round(r.age_factor * 100) / 100,
    Math.round(r.breadth_factor * 100) / 100, r.quality_factor,
    r.implied_value_usd, r.tier === "Watchlist" ? 1 : 0,
  ]);
  const dataJs =
    "window.RADAR = " +
    JSON.stringify({
      meta: {
        as_of: snap.as_of,
        source: "DefiLlama public API, fetched 2026-11-14T01:18:33Z",
        floor_usd: snap.floor_usd,
        scanned: snap.protocols.length,
        watchlist: snap.watchlist.length,
        ranked: boardRows.length,
        global_multiple: Math.round(globalMultiple * 10000) / 10000,
        comparables_n: allRatios.length,
      },
      multiples: Object.fromEntries(
        Object.entries(multiples).map(([k, v]) => [k, [v.median, v.n, v.source === "category" ? 1 : 0]])
      ),
      comparables,
      rows: dataRows,
    }) +
    ";\n";
  writeFileSync(join(outDir, "dashboard", "data.js"), dataJs, "utf8");

  // Copy the page and the screenshots from the repository.
  const here = new URL(".", import.meta.url).pathname;
  cpSync(join(here, "dashboard"), join(outDir, "dashboard"), { recursive: true });
  // data.js was just written; cpSync above would overwrite it with nothing
  // (the repo has no data.js), so write it again after the copy.
  writeFileSync(join(outDir, "dashboard", "data.js"), dataJs, "utf8");
  cpSync(join(here, "screenshots"), join(outDir, "screenshots"), { recursive: true });

  // Dossier: byte-for-byte what the library writes from dashboard/ + screenshots/.
  const dossier = buildDossier(outDir, { text_max_bytes: 65536 });
  writeFileSync(join(outDir, "dossier.json"), Buffer.from(dossier));

  const top = boardRows.slice(0, 5).map((r) => `#${r.rank} ${r.slug} $${r.implied_value_usd.toLocaleString("en-US")}`);
  console.log(`rows=${boardRows.length} watchlist=${snap.watchlist.length} dossier_bytes=${dossier.length}`);
  console.log("top5: " + top.join(" | "));
}

main();
