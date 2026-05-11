#!/usr/bin/env node

/**
 * Merriam-Webster Dictionary & Thesaurus Lookup
 *
 * Usage:
 *   node mw-lookup.js <word>
 *
 * Requires free API keys from https://dictionaryapi.com/register/index
 * Set them as environment variables:
 *   MW_DICT_KEY=your_dictionary_key
 *   MW_THES_KEY=your_thesaurus_key
 *
 * Or pass them inline:
 *   MW_DICT_KEY=abc MW_THES_KEY=xyz node mw-lookup.js hello
 */

const https = require("https");

// ── Config ────────────────────────────────────────────────────────────────────

const DICT_KEY = process.env.MW_DICT_KEY;
const THES_KEY = process.env.MW_THES_KEY;
const BASE_URL = "https://www.dictionaryapi.com/api/v3/references";

// ── ANSI colours ──────────────────────────────────────────────────────────────

const c = {
  reset:  "\x1b[0m",
  bold:   "\x1b[1m",
  dim:    "\x1b[2m",
  cyan:   "\x1b[36m",
  yellow: "\x1b[33m",
  green:  "\x1b[32m",
  red:    "\x1b[31m",
  blue:   "\x1b[34m",
  magenta:"\x1b[35m",
};

const bold    = (s) => `${c.bold}${s}${c.reset}`;
const cyan    = (s) => `${c.cyan}${s}${c.reset}`;
const yellow  = (s) => `${c.yellow}${s}${c.reset}`;
const green   = (s) => `${c.green}${s}${c.reset}`;
const dim     = (s) => `${c.dim}${s}${c.reset}`;
const magenta = (s) => `${c.magenta}${s}${c.reset}`;
const red     = (s) => `${c.red}${s}${c.reset}`;

// ── HTTP helper ───────────────────────────────────────────────────────────────

function get(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          resolve(JSON.parse(data));
        } catch {
          reject(new Error(`Failed to parse response: ${data.slice(0, 120)}`));
        }
      });
    }).on("error", reject);
  });
}

// ── MW text-markup parser ─────────────────────────────────────────────────────
// Strips {bc}, {sx|...|}, {it}...{/it}, {b}...{/b}, {ldquo}/{rdquo}, etc.

function parseMarkup(text = "") {
  return text
    .replace(/\{bc\}/g, ": ")
    .replace(/\{ldquo\}/g, "\u201c")
    .replace(/\{rdquo\}/g, "\u201d")
    .replace(/\{inf\}(.*?)\{\/inf\}/g, "$1")
    .replace(/\{sup\}(.*?)\{\/sup\}/g, "$1")
    .replace(/\{it\}(.*?)\{\/it\}/g, (_, s) => dim(s))
    .replace(/\{b\}(.*?)\{\/b\}/g,   (_, s) => bold(s))
    .replace(/\{sc\}(.*?)\{\/sc\}/g, (_, s) => s.toUpperCase())
    .replace(/\{sx\|([^|]+)\|[^}]*\}/g, (_, w) => cyan(w))
    .replace(/\{a_link\|([^}]+)\}/g, (_, w) => cyan(w))
    .replace(/\{d_link\|([^|]+)\|[^}]*\}/g, (_, w) => cyan(w))
    .replace(/\{[^}]+\}/g, "")   // strip any remaining tags
    .trim();
}

// ── Recursive definition-tree walker ─────────────────────────────────────────

function collectDefs(defSection, results = [], depth = 0) {
  for (const node of defSection) {
    if (!Array.isArray(node)) continue;
    const [tag, ...rest] = node;
    if (tag === "sense") {
      // rest[0] is an object with optional sn, dt, sdsense, etc.
      const sense = rest[0] || {};
      const sn = sense.sn ? dim(`[${sense.sn}]`) + " " : "";
      const dt = sense.dt || [];
      for (const dtNode of dt) {
        if (Array.isArray(dtNode) && dtNode[0] === "text") {
          results.push(`  ${"  ".repeat(depth)}${sn}${parseMarkup(dtNode[1])}`);
        }
      }
      // sdsense = divided sense
      if (sense.sdsense) {
        const sd = sense.sdsense;
        const sdLabel = sd.sd ? dim(`  (${sd.sd}) `) : "";
        const sdDt = sd.dt || [];
        for (const dtNode of sdDt) {
          if (Array.isArray(dtNode) && dtNode[0] === "text") {
            results.push(`  ${"  ".repeat(depth + 1)}${sdLabel}${parseMarkup(dtNode[1])}`);
          }
        }
      }
    } else if (tag === "pseq" || tag === "sseq" || tag === "bs") {
      collectDefs(rest, results, depth + 1);
    }
  }
  return results;
}

// ── Dictionary formatter ──────────────────────────────────────────────────────

function formatDictionary(entries, word) {
  const lines = [];
  lines.push(`\n${bold(cyan("━━━ DICTIONARY"))}  ${bold(word.toUpperCase())}\n`);

  // Group entries by headword so we can show each form cleanly
  const shown = new Set();

  for (const entry of entries) {
    if (typeof entry !== "object" || !entry.meta) continue;

    const hw   = (entry.hwi?.hw || entry.meta.id).replace(/\*/g, "·");
    const fl   = entry.fl   || "";           // functional label (part of speech)
    const prs  = entry.hwi?.prs?.[0]?.mw || "";
    const key  = entry.meta.id;

    if (shown.has(key)) continue;
    shown.add(key);

    // Headword line
    const pron = prs ? dim(` /${prs}/`) : "";
    lines.push(`${bold(yellow(hw))}${pron}  ${magenta(fl)}`);

    // Definitions
    const defs = entry.def || [];
    for (const defBlock of defs) {
      const vd = defBlock.vd ? `  ${dim(defBlock.vd)}\n` : "";
      if (vd) lines.push(vd);
      const sseq = defBlock.sseq || [];
      const collected = collectDefs(sseq);
      lines.push(...collected);
    }

    // Short definitions (fallback if def tree is empty)
    if ((entry.def || []).length === 0 && entry.shortdef) {
      entry.shortdef.forEach((d, i) => lines.push(`  ${dim(i + 1 + ".")} ${parseMarkup(d)}`));
    }

    // Usage / etymology snippets
    if (entry.et) {
      const etText = entry.et
        .filter(([t]) => t === "text")
        .map(([, v]) => parseMarkup(v))
        .join(" ");
      if (etText) lines.push(`\n  ${dim("Etymology:")} ${dim(etText)}`);
    }

    lines.push(""); // spacer between entries
  }

  return lines.join("\n");
}

// ── Thesaurus formatter ───────────────────────────────────────────────────────

function formatThesaurus(entries, word) {
  const lines = [];
  lines.push(`\n${bold(green("━━━ THESAURUS"))}  ${bold(word.toUpperCase())}\n`);

  const shown = new Set();

  for (const entry of entries) {
    if (typeof entry !== "object" || !entry.meta) continue;

    const hw = (entry.hwi?.hw || entry.meta.id).replace(/\*/g, "·");
    const fl = entry.fl || "";
    const key = entry.meta.id;

    if (shown.has(key)) continue;
    shown.add(key);

    lines.push(`${bold(yellow(hw))}  ${magenta(fl)}`);

    const defs = entry.def || [];
    for (const defBlock of defs) {
      for (const sseqRow of defBlock.sseq || []) {
        for (const node of sseqRow) {
          if (!Array.isArray(node) || node[0] !== "sense") continue;
          const sense = node[1] || {};
          const sn    = sense.sn ? dim(`[${sense.sn}]`) + " " : "";

          // Sense definition text
          const defText = (sense.dt || [])
            .filter(([t]) => t === "text")
            .map(([, v]) => parseMarkup(v))
            .join(" ");
          if (defText) lines.push(`  ${sn}${defText}`);

          // Synonyms
          const syns = (sense.syn_list || []).flat().map((s) => s.wd).filter(Boolean);
          if (syns.length) lines.push(`    ${green("synonyms:")}  ${syns.join(", ")}`);

          // Related words
          const rels = (sense.rel_list || []).flat().map((s) => s.wd).filter(Boolean);
          if (rels.length) lines.push(`    ${cyan("related:")}   ${rels.join(", ")}`);

          // Near antonyms
          const nears = (sense.near_list || []).flat().map((s) => s.wd).filter(Boolean);
          if (nears.length) lines.push(`    ${yellow("near ant:")} ${nears.join(", ")}`);

          // Antonyms
          const ants = (sense.ant_list || []).flat().map((s) => s.wd).filter(Boolean);
          if (ants.length) lines.push(`    ${red("antonyms:")}  ${ants.join(", ")}`);
        }
      }
    }
    lines.push("");
  }

  return lines.join("\n");
}

// ── Suggestions handler ───────────────────────────────────────────────────────

function formatSuggestions(data, word, source) {
  if (!Array.isArray(data) || data.length === 0 || typeof data[0] !== "string") return "";
  return `\n${dim(`No ${source} results for "${word}". Did you mean one of these?`)}\n` +
    data.map((s) => `  • ${cyan(s)}`).join("\n");
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const word = process.argv[2];

  if (!word) {
    console.error(red("Usage: node mw-lookup.js <word>"));
    process.exit(1);
  }

  if (!DICT_KEY && !THES_KEY) {
    console.error(
      red("No API keys found.") +
      "\nSet MW_DICT_KEY and/or MW_THES_KEY environment variables." +
      "\nGet free keys at: https://dictionaryapi.com/register/index"
    );
    process.exit(1);
  }

  const encoded = encodeURIComponent(word.toLowerCase());
  const tasks = [];

  if (DICT_KEY) {
    tasks.push(
      get(`${BASE_URL}/collegiate/json/${encoded}?key=${DICT_KEY}`)
        .then((data) => ({ type: "dict", data }))
        .catch((err) => ({ type: "dict", error: err.message }))
    );
  }

  if (THES_KEY) {
    tasks.push(
      get(`${BASE_URL}/thesaurus/json/${encoded}?key=${THES_KEY}`)
        .then((data) => ({ type: "thes", data }))
        .catch((err) => ({ type: "thes", error: err.message }))
    );
  }

  const results = await Promise.all(tasks);

  for (const result of results) {
    if (result.error) {
      console.error(red(`Error (${result.type}): ${result.error}`));
      continue;
    }

    const { type, data } = result;

    if (type === "dict") {
      if (Array.isArray(data) && data.length && typeof data[0] === "object") {
        console.log(formatDictionary(data, word));
      } else {
        console.log(formatSuggestions(data, word, "dictionary"));
      }
    }

    if (type === "thes") {
      if (Array.isArray(data) && data.length && typeof data[0] === "object") {
        console.log(formatThesaurus(data, word));
      } else {
        console.log(formatSuggestions(data, word, "thesaurus"));
      }
    }
  }
}

main().catch((err) => {
  console.error(red("Unexpected error: " + err.message));
  process.exit(1);
});