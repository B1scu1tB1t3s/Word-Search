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
 *
 * Debug mode (prints raw API response):
 *   MW_DEBUG=1 node mw-lookup.js hello
 */

const https = require("https");

// ── Config ────────────────────────────────────────────────────────────────────

const DICT_KEY  = process.env.MW_DICT_KEY=your_dictionary_api_key;
const THES_KEY  = process.env.MW_THES_KEY=your_thesaurus_api_key;
const DEBUG     = process.env.MW_DEBUG === "1";
const BASE_URL  = "https://www.dictionaryapi.com/api/v3/references";

// ── ANSI colours ──────────────────────────────────────────────────────────────

process.stdout.write("\x1b[?25l\x1b[?25h"); // triggers ANSI mode in legacy cmd
const bold    = (s) => `\x1b[1m${s}\x1b[0m`;
const dim     = (s) => `\x1b[2m${s}\x1b[0m`;
const cyan    = (s) => `\x1b[36m${s}\x1b[0m`;
const yellow  = (s) => `\x1b[33m${s}\x1b[0m`;
const green   = (s) => `\x1b[32m${s}\x1b[0m`;
const red     = (s) => `\x1b[31m${s}\x1b[0m`;
const magenta = (s) => `\x1b[35m${s}\x1b[0m`;

// ── HTTP helper ───────────────────────────────────────────────────────────────

function get(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try { resolve(JSON.parse(data)); }
        catch { reject(new Error(`Bad JSON: ${data.slice(0, 200)}`)); }
      });
    }).on("error", reject);
  });
}

// ── MW inline markup → plain/styled text ─────────────────────────────────────

function markup(text = "") {
  return text
    .replace(/\{bc\}/g, ": ")
    .replace(/\{ldquo\}/g, "\u201c")
    .replace(/\{rdquo\}/g, "\u201d")
    .replace(/\{inf\}(.*?)\{\/inf\}/g, "$1")
    .replace(/\{sup\}(.*?)\{\/sup\}/g, "$1")
    .replace(/\{it\}(.*?)\{\/it\}/g,   (_, s) => dim(s))
    .replace(/\{b\}(.*?)\{\/b\}/g,     (_, s) => bold(s))
    .replace(/\{sc\}(.*?)\{\/sc\}/g,   (_, s) => s.toUpperCase())
    .replace(/\{sx\|([^|]+)\|[^}]*\}/g, (_, w) => cyan(w))
    .replace(/\{[a-z_]+\|([^|]+)\|[^}]*\}/g, (_, w) => cyan(w))
    .replace(/\{[^}]+\}/g, "")
    .trim();
}

// ── Extract text from a dt (definition text) array ───────────────────────────

function dtText(dt = []) {
  return dt
    .filter((n) => Array.isArray(n) && n[0] === "text")
    .map((n) => markup(n[1]))
    .join(" ");
}

// ── Parse one sense object into output lines ──────────────────────────────────

function parseSense(sense, indent = "  ") {
  const lines = [];
  const sn    = sense.sn ? dim(`[${sense.sn}]`) + " " : "";
  const text  = dtText(sense.dt);
  if (text) lines.push(`${indent}${sn}${text}`);

  // divided sense  e.g. "a : ... broadly : ..."
  if (sense.sdsense) {
    const label = sense.sdsense.sd ? dim(`${sense.sdsense.sd} `) : "";
    const sdtxt = dtText(sense.sdsense.dt);
    if (sdtxt) lines.push(`${indent}  ${label}${sdtxt}`);
  }
  return lines;
}

// ── Walk an sseq (sense sequence) ────────────────────────────────────────────
//
//  MW structure:
//    def[i].sseq   →  array of "sense groups"
//    sense group   →  array of sense-nodes: [ [tag, content], … ]
//    tags          →  "sense" | "bs" | "pseq" | "sen" | "sn" …

function walkSseq(sseq = []) {
  const lines = [];
  for (const senseGroup of sseq) {
    for (const node of senseGroup) {
      if (!Array.isArray(node)) continue;
      const [tag, content] = node;

      if (tag === "sense") {
        lines.push(...parseSense(content));

      } else if (tag === "bs") {
        // binding substitution — wraps a sense one level deeper
        if (content && content.sense) lines.push(...parseSense(content.sense));

      } else if (tag === "pseq") {
        // parenthesized sense sequence — content is an array of nodes
        for (const inner of content) {
          if (Array.isArray(inner) && inner[0] === "sense") {
            lines.push(...parseSense(inner[1], "    "));
          }
        }
      }
    }
  }
  return lines;
}

// ── Dictionary output ─────────────────────────────────────────────────────────

function formatDictionary(entries, word) {
  const out  = [`\n${bold(cyan("━━━ DICTIONARY"))}  ${bold(word.toUpperCase())}\n`];
  const seen = new Set();

  for (const entry of entries) {
    if (typeof entry !== "object" || !entry.meta) continue;
    if (seen.has(entry.meta.id)) continue;
    seen.add(entry.meta.id);

    const hw   = (entry.hwi?.hw ?? entry.meta.id).replace(/\*/g, "·");
    const pron = entry.hwi?.prs?.[0]?.mw ? dim(` /${entry.hwi.prs[0].mw}/`) : "";
    const fl   = entry.fl ? magenta(entry.fl) : "";

    out.push(`${bold(yellow(hw))}${pron}  ${fl}`);

    let hadDefs = false;
    for (const defBlock of (entry.def ?? [])) {
      if (defBlock.vd) out.push(`  ${dim(defBlock.vd)}`);
      const defs = walkSseq(defBlock.sseq);
      if (defs.length) { out.push(...defs); hadDefs = true; }
    }

    // Fallback to shortdef if sseq yielded nothing
    if (!hadDefs && entry.shortdef?.length) {
      entry.shortdef.forEach((d, i) => out.push(`  ${dim(i + 1 + ".")} ${markup(d)}`));
    }

    // Etymology
    const etText = (entry.et ?? [])
      .filter(([t]) => t === "text")
      .map(([, v]) => markup(v))
      .join(" ");
    if (etText) out.push(`\n  ${dim("Etymology:")} ${dim(etText)}`);

    out.push("");
  }
  return out.join("\n");
}

// ── Thesaurus output ──────────────────────────────────────────────────────────

function formatThesaurus(entries, word) {
  const out  = [`\n${bold(green("━━━ THESAURUS"))}  ${bold(word.toUpperCase())}\n`];
  const seen = new Set();

  for (const entry of entries) {
    if (typeof entry !== "object" || !entry.meta) continue;
    if (seen.has(entry.meta.id)) continue;
    seen.add(entry.meta.id);

    const hw = (entry.hwi?.hw ?? entry.meta.id).replace(/\*/g, "·");
    const fl = entry.fl ? magenta(entry.fl) : "";
    out.push(`${bold(yellow(hw))}  ${fl}`);

    for (const defBlock of (entry.def ?? [])) {
      for (const senseGroup of (defBlock.sseq ?? [])) {
        for (const node of senseGroup) {
          if (!Array.isArray(node) || node[0] !== "sense") continue;
          const sense = node[1];
          const sn    = sense.sn ? dim(`[${sense.sn}]`) + " " : "";

          const defText = dtText(sense.dt);
          if (defText) out.push(`  ${sn}${defText}`);

          const words = (list) => (list ?? []).flat().map((s) => s.wd).filter(Boolean);

          const syns  = words(sense.syn_list);
          const rels  = words(sense.rel_list);
          const nears = words(sense.near_list);
          const ants  = words(sense.ant_list);

          if (syns.length)  out.push(`    ${green("synonyms:")}   ${syns.join(", ")}`);
          if (rels.length)  out.push(`    ${cyan("related:")}    ${rels.join(", ")}`);
          if (nears.length) out.push(`    ${yellow("near ant:")}  ${nears.join(", ")}`);
          if (ants.length)  out.push(`    ${red("antonyms:")}   ${ants.join(", ")}`);
          if (syns.length || rels.length || nears.length || ants.length) out.push("");
        }
      }
    }
    out.push("");
  }
  return out.join("\n");
}

// ── Suggestions ───────────────────────────────────────────────────────────────

function suggestions(data, word, source) {
  if (!Array.isArray(data) || !data.length || typeof data[0] !== "string") return null;
  return `\n${dim(`No ${source} results for "${word}". Did you mean:`)}\n` +
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
      red("No API keys found.\n") +
      "Set MW_DICT_KEY and/or MW_THES_KEY as environment variables.\n" +
      "Get free keys at: https://dictionaryapi.com/register/index"
    );
    process.exit(1);
  }

  const encoded = encodeURIComponent(word.toLowerCase());
  const tasks   = [];

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

  for (const { type, data, error } of results) {
    if (error) { console.error(red(`Error (${type}): ${error}`)); continue; }

    if (DEBUG) console.error(`\n[DEBUG ${type}]\n`, JSON.stringify(data, null, 2));

    const isEntries = Array.isArray(data) && data.length && typeof data[0] === "object";

    if (type === "dict") {
      console.log(isEntries
        ? formatDictionary(data, word)
        : (suggestions(data, word, "dictionary") ?? red(`No dictionary results for "${word}"`)));
    }
    if (type === "thes") {
      console.log(isEntries
        ? formatThesaurus(data, word)
        : (suggestions(data, word, "thesaurus") ?? red(`No thesaurus results for "${word}"`)));
    }
  }
}

main().catch((err) => {
  console.error(red("Unexpected error: " + err.message));
  process.exit(1);
});
