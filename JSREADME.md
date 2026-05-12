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
