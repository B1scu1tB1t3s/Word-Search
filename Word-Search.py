#!/usr/bin/env python3
"""
Merriam-Webster Dictionary & Thesaurus Lookup
----------------------------------------------
Requires free API keys from: https://dictionaryapi.com/register/index

Usage:
    python mw_lookup.py <word>
    python mw_lookup.py serendipity
    python mw_lookup.py --dict-only happy
    python mw_lookup.py --thes-only happy

Set your API keys via environment variables or edit the constants below:
    export MW_DICT_KEY="your-dictionary-key"
    export MW_THES_KEY="your-thesaurus-key"
"""

import sys
import os
import json
import argparse
import textwrap
import urllib.request
import urllib.error

# ── API Keys ────────────────────────────────────────────────────────────────
# Get free keys at https://dictionaryapi.com/register/index
# You can also set these as environment variables.
MW_DICT_KEY = "paste-your-dictionary-key-here"
MW_THES_KEY  = "paste-your-thesaurus-key-here"

MW_DICT_URL = "https://www.dictionaryapi.com/api/v3/references/collegiate/json/{word}?key={key}"
MW_THES_URL  = "https://www.dictionaryapi.com/api/v3/references/thesaurus/json/{word}?key={key}"

# ── ANSI colours ─────────────────────────────────────────────────────────────
BOLD   = "\033[1m"
CYAN   = "\033[36m"
GREEN  = "\033[32m"
YELLOW = "\033[33m"
DIM    = "\033[2m"
RESET  = "\033[0m"

WRAP = 90  # line-wrap width for definitions/examples


# ── Helpers ──────────────────────────────────────────────────────────────────

def fetch(url: str) -> list | None:
    """Fetch JSON from a URL; return None on error."""
    try:
        with urllib.request.urlopen(url, timeout=10) as resp:
            return json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        print(f"  HTTP {e.code}: {e.reason}")
    except urllib.error.URLError as e:
        print(f"  Network error: {e.reason}")
    except json.JSONDecodeError:
        print("  Could not parse API response.")
    return None


def strip_markup(text: str) -> str:
    """Remove Merriam-Webster inline markup tokens like {bc}, {it}, {/it}."""
    import re
    # Remove {bc} (bold colon separator), {ldquo}/{rdquo}, {sx|...||}
    text = re.sub(r"\{bc\}", ": ", text)
    text = re.sub(r"\{ldquo\}", "\u201c", text)
    text = re.sub(r"\{rdquo\}", "\u201d", text)
    # {it}word{/it}  →  word (italic in terminal not practical, just unwrap)
    text = re.sub(r"\{/?it\}", "_", text)
    text = re.sub(r"\{/?b\}", "", text)
    text = re.sub(r"\{/?sc\}", "", text)
    # {sx|word||} or {dxt|word:hom:sense||}  →  word
    text = re.sub(r"\{(?:sx|dxt)\|([^|]+)\|[^}]*\}", r"\1", text)
    # {a_link|word} {d_link|word|id}
    text = re.sub(r"\{[a-z_]+\|([^|}]+)(?:\|[^}]*)?\}", r"\1", text)
    # Any remaining {token} → remove
    text = re.sub(r"\{[^}]+\}", "", text)
    return text.strip()


def wrap(text: str, indent: int = 4) -> str:
    prefix = " " * indent
    return textwrap.fill(text, width=WRAP, initial_indent=prefix,
                         subsequent_indent=prefix)


def section(title: str) -> None:
    line = "─" * WRAP
    print(f"\n{BOLD}{CYAN}{line}{RESET}")
    print(f"{BOLD}{CYAN}  {title}{RESET}")
    print(f"{BOLD}{CYAN}{line}{RESET}")


def divider() -> None:
    print(f"{DIM}{'·' * WRAP}{RESET}")


# ── Dictionary ────────────────────────────────────────────────────────────────

def show_dictionary(word: str) -> None:
    """Fetch and display dictionary entries for *word*."""
    section(f'📖  DICTIONARY  —  "{word}"')

    if MW_DICT_KEY == "paste-your-dictionary-key-here":
        print(f"\n  {YELLOW}⚠  No dictionary API key set.{RESET}")
        print("     Get a free key at https://dictionaryapi.com/register/index")
        print("     Then set MW_DICT_KEY or edit the constant at the top of this file.")
        return

    url  = MW_DICT_URL.format(word=urllib.parse.quote(word), key=MW_DICT_KEY)
    data = fetch(url)
    if data is None:
        return

    # MW returns a list of strings (suggestions) if the word isn't found
    if data and isinstance(data[0], str):
        print(f"\n  Word not found. Did you mean one of these?\n")
        for s in data[:8]:
            print(f"    • {s}")
        return

    shown = 0
    for entry in data:
        if not isinstance(entry, dict):
            continue
        hw   = entry.get("hwi", {}).get("hw", word).replace("*", "·")
        fl   = entry.get("fl", "")          # functional label (noun, verb …)
        stems = entry.get("meta", {}).get("stems", [])

        # ── Pronunciation ──────────────────────────────────────────────────
        prs = entry.get("hwi", {}).get("prs", [])
        pron = ""
        if prs:
            mw_pron = prs[0].get("mw", "")
            ipa     = prs[0].get("ipa", "")
            pron    = f"  /{ipa or mw_pron}/"

        # ── Short definitions ──────────────────────────────────────────────
        short_defs = entry.get("shortdef", [])

        # ── Full senses ───────────────────────────────────────────────────
        def_section = entry.get("def", [])

        print()
        print(f"  {BOLD}{GREEN}{hw}{RESET}  {DIM}{fl}{RESET}{YELLOW}{pron}{RESET}")
        if stems and len(stems) > 1:
            print(f"  {DIM}Forms: {', '.join(stems[:6])}{RESET}")

        if short_defs:
            print()
            for i, d in enumerate(short_defs, 1):
                print(wrap(f"{i}. {strip_markup(d)}"))

        # Verbose senses with examples
        examples_shown = 0
        for ds_block in def_section:
            for sseq in ds_block.get("sseq", []):
                for sense_wrapper in sseq:
                    if not isinstance(sense_wrapper, list) or len(sense_wrapper) < 2:
                        continue
                    sense_type, sense_data = sense_wrapper
                    if sense_type not in ("sense", "bs"):
                        continue
                    if isinstance(sense_data, dict) and "dt" in sense_data:
                        for dt_pair in sense_data["dt"]:
                            if dt_pair[0] == "vis" and examples_shown < 2:
                                for vis in dt_pair[1]:
                                    t = strip_markup(vis.get("t", ""))
                                    if t:
                                        if examples_shown == 0:
                                            print(f"\n  {DIM}Examples:{RESET}")
                                        print(wrap(f'• "{t}"', indent=6))
                                        examples_shown += 1

        shown += 1
        if shown < len([e for e in data if isinstance(e, dict)]):
            divider()

    if shown == 0:
        print("  No entries found.")


# ── Thesaurus ─────────────────────────────────────────────────────────────────

def show_thesaurus(word: str) -> None:
    """Fetch and display thesaurus entries for *word*."""
    section(f'🔄  THESAURUS  —  "{word}"')

    if MW_THES_KEY == "paste-your-thesaurus-key-here":
        print(f"\n  {YELLOW}⚠  No thesaurus API key set.{RESET}")
        print("     Get a free key at https://dictionaryapi.com/register/index")
        print("     Then set MW_THES_KEY or edit the constant at the top of this file.")
        return

    url  = MW_THES_URL.format(word=urllib.parse.quote(word), key=MW_THES_KEY)
    data = fetch(url)
    if data is None:
        return

    if data and isinstance(data[0], str):
        print(f"\n  Word not found. Did you mean one of these?\n")
        for s in data[:8]:
            print(f"    • {s}")
        return

    for entry in data:
        if not isinstance(entry, dict):
            continue
        hw = entry.get("hwi", {}).get("hw", word).replace("*", "·")
        fl = entry.get("fl", "")
        short_defs = entry.get("shortdef", [])

        print()
        print(f"  {BOLD}{GREEN}{hw}{RESET}  {DIM}{fl}{RESET}")

        def_section = entry.get("def", [])
        sense_num = 0
        for ds_block in def_section:
            for sseq in ds_block.get("sseq", []):
                for sense_wrapper in sseq:
                    if not isinstance(sense_wrapper, list) or len(sense_wrapper) < 2:
                        continue
                    sense_type, sense_data = sense_wrapper
                    if sense_type not in ("sense", "bs"):
                        continue
                    if not isinstance(sense_data, dict):
                        continue

                    dt = sense_data.get("dt", [])
                    syns_data = sense_data.get("syn_list", [])
                    ants_data = sense_data.get("ant_list", [])
                    rel_data  = sense_data.get("rel_list", [])
                    near_data = sense_data.get("near_list", [])

                    # Definition for this sense
                    def_text = ""
                    for dt_pair in dt:
                        if dt_pair[0] == "text":
                            def_text = strip_markup(dt_pair[1])
                            break

                    sense_num += 1
                    label = short_defs[sense_num - 1] if sense_num <= len(short_defs) else def_text
                    if label:
                        print(f"\n  {BOLD}{sense_num}. {strip_markup(label)}{RESET}")

                    def flatten_word_list(wl):
                        words = []
                        for group in wl:
                            for item in group:
                                w = item.get("wd", "")
                                if w:
                                    words.append(w)
                        return words

                    syns  = flatten_word_list(syns_data)
                    ants  = flatten_word_list(ants_data)
                    rels  = flatten_word_list(rel_data)
                    nears = flatten_word_list(near_data)

                    if syns:
                        print(wrap(f"{GREEN}Synonyms:{RESET}  {', '.join(syns)}", indent=4))
                    if ants:
                        print(wrap(f"{YELLOW}Antonyms:{RESET}  {', '.join(ants)}", indent=4))
                    if rels:
                        print(wrap(f"{DIM}Related: {', '.join(rels[:12])}{RESET}", indent=4))
                    if nears:
                        print(wrap(f"{DIM}Near antonyms: {', '.join(nears[:10])}{RESET}", indent=4))

        divider()


# ── CLI ───────────────────────────────────────────────────────────────────────

def main():
    # urllib.parse needed for URL encoding
    global urllib
    import urllib.parse  # noqa: F811 — extend the already-imported package

    parser = argparse.ArgumentParser(
        description="Look up a word in the Merriam-Webster Dictionary and Thesaurus.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument("word", help="The word to look up")
    parser.add_argument("--dict-only",  action="store_true", help="Show dictionary only")
    parser.add_argument("--thes-only",  action="store_true", help="Show thesaurus only")
    args = parser.parse_args()

    word = args.word.strip().lower()

    if args.thes_only:
        show_thesaurus(word)
    elif args.dict_only:
        show_dictionary(word)
    else:
        show_dictionary(word)
        show_thesaurus(word)

    print()


if __name__ == "__main__":
    main()
