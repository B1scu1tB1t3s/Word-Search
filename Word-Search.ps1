<#
.SYNOPSIS
    Search Merriam-Webster Dictionary and Thesaurus for a word.

.DESCRIPTION
    Uses the official Merriam-Webster API to look up definitions, parts of speech,
    example sentences, and synonyms/antonyms for any word.

    SETUP: Get free API keys at https://dictionaryapi.com/register/index
      - Request the "Collegiate Dictionary" key  → paste into $DictionaryApiKey
      - Request the "Collegiate Thesaurus" key   → paste into $ThesaurusApiKey

.PARAMETER Word
    The word to look up. Prompts interactively if omitted.

.PARAMETER DictionaryApiKey
    Your Merriam-Webster Collegiate Dictionary API key.

.PARAMETER ThesaurusApiKey
    Your Merriam-Webster Collegiate Thesaurus API key.

.PARAMETER SkipDictionary
    Skip the dictionary lookup (show thesaurus only).

.PARAMETER SkipThesaurus
    Skip the thesaurus lookup (show dictionary only).

.PARAMETER MaxDefinitions
    Maximum number of definitions to display per entry (default: 3).

.EXAMPLE
    .\Search-MerriamWebster.ps1 -Word "ephemeral"

.EXAMPLE
    .\Search-MerriamWebster.ps1 -Word "happy" -SkipDictionary

.EXAMPLE
    .\Search-MerriamWebster.ps1
    # Prompts for word and API keys interactively
#>

[CmdletBinding()]
param(
    [Parameter(Position = 0)]
    [string]$Word,

    [string]$DictionaryApiKey = $env:MW_DICTIONARY_KEY,
    [string]$ThesaurusApiKey  = $env:MW_THESAURUS_KEY,

    [switch]$SkipDictionary,
    [switch]$SkipThesaurus,

    [ValidateRange(1,10)]
    [int]$MaxDefinitions = 3
)

#region ── Helpers ─────────────────────────────────────────────────────────────

function Write-Header {
    param([string]$Text, [ConsoleColor]$Color = 'Cyan')
    $line = '─' * ($Text.Length + 4)
    Write-Host ""
    Write-Host "  $line" -ForegroundColor $Color
    Write-Host "  │ $Text │" -ForegroundColor $Color
    Write-Host "  $line" -ForegroundColor $Color
}

function Write-Section {
    param([string]$Label, [ConsoleColor]$Color = 'Yellow')
    Write-Host ""
    Write-Host "  ▸ $Label" -ForegroundColor $Color
    Write-Host "  $('─' * 50)" -ForegroundColor DarkGray
}

function Write-Bullet {
    param([string]$Text, [int]$Indent = 4, [ConsoleColor]$Color = 'White')
    Write-Host (' ' * $Indent + '• ' + $Text) -ForegroundColor $Color
}

# Strip Merriam-Webster inline markup tokens  {bc}, {sx|word||}, {it}, etc.
function Clear-MWMarkup {
    param([string]$Text)
    if (-not $Text) { return '' }
    $Text = $Text -replace '\{bc\}',           ': '
    $Text = $Text -replace '\{ldquo\}',        '"'
    $Text = $Text -replace '\{rdquo\}',        '"'
    $Text = $Text -replace '\{it\}(.*?)\{\/it\}', '$1'
    $Text = $Text -replace '\{b\}(.*?)\{\/b\}',   '$1'
    $Text = $Text -replace '\{inf\}(.*?)\{\/inf\}','$1'
    $Text = $Text -replace '\{sup\}(.*?)\{\/sup\}','$1'
    $Text = $Text -replace '\{sc\}(.*?)\{\/sc\}',  '$1'
    $Text = $Text -replace '\{sx\|([^|]+)\|[^}]*\}','$1'
    $Text = $Text -replace '\{a_link\|([^}]+)\}',  '$1'
    $Text = $Text -replace '\{d_link\|([^|]+)\|[^}]*\}','$1'
    $Text = $Text -replace '\{[^}]+\}',        ''   # remove any remaining tags
    return $Text.Trim()
}

# Recursively collect "dt" (definition text) strings from the nested sense tree
function Get-DefinitionTexts {
    param($SenseArray)
    $results = @()
    foreach ($sense in $SenseArray) {
        if ($sense -is [System.Collections.IEnumerable] -and $sense -isnot [string]) {
            $arr = @($sense)
            if ($arr.Count -ge 2 -and $arr[0] -eq 'dt') {
                # dt value is an array of [type, content] pairs
                foreach ($dtItem in @($arr[1])) {
                    $pair = @($dtItem)
                    if ($pair.Count -ge 2 -and $pair[0] -eq 'text') {
                        $results += Clear-MWMarkup $pair[1]
                    }
                }
            } else {
                $results += Get-DefinitionTexts $arr
            }
        }
    }
    return $results
}

function Invoke-MWApi {
    param([string]$Word, [string]$ApiKey, [string]$Type)
    $encoded = [uri]::EscapeDataString($Word)
    $url     = "https://www.dictionaryapi.com/api/v3/references/$Type/json/${encoded}?key=${ApiKey}"
    try {
        $response = Invoke-RestMethod -Uri $url -Method Get -ErrorAction Stop
        return $response
    } catch {
        Write-Host "  [ERROR] API call failed: $_" -ForegroundColor Red
        return $null
    }
}

#endregion

#region ── Input collection ────────────────────────────────────────────────────

if (-not $Word) {
    Write-Host ""
    Write-Host "  Merriam-Webster Lookup" -ForegroundColor Cyan
    Write-Host "  ──────────────────────" -ForegroundColor DarkGray
    $Word = (Read-Host "  Enter a word").Trim()
}

if (-not $Word) { Write-Host "  No word provided. Exiting." -ForegroundColor Red; exit 1 }

if (-not $SkipDictionary -and -not $DictionaryApiKey) {
    Write-Host ""
    Write-Host "  No dictionary API key found." -ForegroundColor Yellow
    Write-Host "  Get a free key at: https://dictionaryapi.com/register/index" -ForegroundColor DarkGray
    $DictionaryApiKey = (Read-Host "  Dictionary API key (or press Enter to skip)").Trim()
    if (-not $DictionaryApiKey) { $SkipDictionary = $true }
}

if (-not $SkipThesaurus -and -not $ThesaurusApiKey) {
    Write-Host ""
    Write-Host "  No thesaurus API key found." -ForegroundColor Yellow
    $ThesaurusApiKey = (Read-Host "  Thesaurus API key (or press Enter to skip)").Trim()
    if (-not $ThesaurusApiKey) { $SkipThesaurus = $true }
}

#endregion

#region ── Dictionary ──────────────────────────────────────────────────────────

if (-not $SkipDictionary) {
    Write-Header "DICTIONARY: $($Word.ToUpper())" -Color Cyan

    $dictData = Invoke-MWApi -Word $Word -ApiKey $DictionaryApiKey -Type 'collegiate'

    if (-not $dictData) {
        Write-Host "  No results returned." -ForegroundColor DarkGray
    } elseif ($dictData[0] -is [string]) {
        # MW returns an array of suggestion strings when word not found
        Write-Host ""
        Write-Host "  Word not found. Did you mean one of these?" -ForegroundColor Yellow
        $dictData | Select-Object -First 8 | ForEach-Object { Write-Bullet $_ -Color Gray }
    } else {
        $entryCount = 0
        foreach ($entry in $dictData) {
            # Each entry has a headword (.hwi.hw) and functional label (.fl)
            $hw  = if ($entry.hwi.hw)  { $entry.hwi.hw  -replace '\*','-' } else { $Word }
            $fl  = if ($entry.fl)      { $entry.fl } else { '' }
            $pr  = if ($entry.hwi.prs) { "/$($entry.hwi.prs[0].mw)/" } else { '' }

            Write-Section "$hw  [$fl]  $pr" -Color Green

            # Definitions
            $defCount = 0
            if ($entry.def) {
                foreach ($defBlock in $entry.def) {
                    foreach ($sseq in $defBlock.sseq) {
                        foreach ($senseGroup in $sseq) {
                            $senseItems = @($senseGroup)
                            # Each item is ['sense', { dt: [...], ... }] or ['bs', ...]
                            $senseData = $null
                            if ($senseItems.Count -ge 2) {
                                $senseData = $senseItems[1]
                            }
                            if ($senseData -and $senseData.dt) {
                                $texts = Get-DefinitionTexts $senseData.dt
                                foreach ($t in $texts) {
                                    if ($t -and $defCount -lt $MaxDefinitions) {
                                        $defCount++
                                        Write-Host ("    $defCount. $t") -ForegroundColor White
                                    }
                                }
                            }
                            if ($defCount -ge $MaxDefinitions) { break }
                        }
                        if ($defCount -ge $MaxDefinitions) { break }
                    }
                    if ($defCount -ge $MaxDefinitions) { break }
                }
            }

            # Example sentences (vis)
            $examples = @()
            if ($entry.def) {
                foreach ($defBlock in $entry.def) {
                    foreach ($sseq in $defBlock.sseq) {
                        foreach ($senseGroup in $sseq) {
                            $senseItems = @($senseGroup)
                            if ($senseItems.Count -ge 2 -and $senseItems[1].dt) {
                                foreach ($dtPair in $senseItems[1].dt) {
                                    $p = @($dtPair)
                                    if ($p.Count -ge 2 -and $p[0] -eq 'vis') {
                                        foreach ($ex in @($p[1])) {
                                            $t = Clear-MWMarkup $ex.t
                                            if ($t) { $examples += $t }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
            if ($examples.Count -gt 0) {
                Write-Host ""
                Write-Host "    Example:" -ForegroundColor DarkCyan
                Write-Host ("      "" + $examples[0] + """) -ForegroundColor Gray
            }

            # Etymology
            if ($entry.et) {
                $etText = ''
                foreach ($etItem in $entry.et) {
                    $ep = @($etItem)
                    if ($ep.Count -ge 2 -and $ep[0] -eq 'text') {
                        $etText = Clear-MWMarkup $ep[1]
                    }
                }
                if ($etText) {
                    Write-Host ""
                    Write-Host "    Etymology: $etText" -ForegroundColor DarkMagenta
                }
            }

            # Date of first use
            if ($entry.date) {
                $dateText = Clear-MWMarkup $entry.date
                Write-Host "    First known use: $dateText" -ForegroundColor DarkGray
            }

            $entryCount++
            if ($entryCount -ge 4) {
                Write-Host ""
                Write-Host "    (showing first 4 entries of $($dictData.Count) total)" -ForegroundColor DarkGray
                break
            }
        }
    }
}

#endregion

#region ── Thesaurus ───────────────────────────────────────────────────────────

if (-not $SkipThesaurus) {
    Write-Header "THESAURUS: $($Word.ToUpper())" -Color Magenta

    $thesData = Invoke-MWApi -Word $Word -ApiKey $ThesaurusApiKey -Type 'thesaurus'

    if (-not $thesData) {
        Write-Host "  No results returned." -ForegroundColor DarkGray
    } elseif ($thesData[0] -is [string]) {
        Write-Host ""
        Write-Host "  Word not found. Did you mean one of these?" -ForegroundColor Yellow
        $thesData | Select-Object -First 8 | ForEach-Object { Write-Bullet $_ -Color Gray }
    } else {
        foreach ($entry in $thesData | Select-Object -First 3) {
            $hw = if ($entry.hwi.hw) { $entry.hwi.hw -replace '\*','-' } else { $Word }
            $fl = if ($entry.fl)     { $entry.fl } else { '' }

            Write-Section "$hw  [$fl]" -Color DarkYellow

            if ($entry.def) {
                $senseNum = 0
                foreach ($defBlock in $entry.def) {
                    foreach ($sseq in $defBlock.sseq) {
                        foreach ($senseGroup in $sseq) {
                            $sg = @($senseGroup)
                            $senseData = if ($sg.Count -ge 2) { $sg[1] } else { $null }
                            if (-not $senseData) { continue }

                            $senseNum++

                            # Short definition
                            if ($senseData.sdsense -and $senseData.sdsense.sd) {
                                Write-Host ("    Sense $senseNum — " + (Clear-MWMarkup $senseData.sdsense.sd)) -ForegroundColor DarkGray
                            } elseif ($senseData.dt) {
                                $shortDef = Get-DefinitionTexts $senseData.dt | Select-Object -First 1
                                if ($shortDef) {
                                    Write-Host ("    Sense $senseNum — $shortDef") -ForegroundColor DarkGray
                                }
                            }

                            # Synonyms
                            $syns = @()
                            if ($senseData.syn_list) {
                                foreach ($synGroup in $senseData.syn_list) {
                                    foreach ($s in @($synGroup)) { if ($s.wd) { $syns += $s.wd } }
                                }
                            }
                            if ($syns.Count -gt 0) {
                                Write-Host ""
                                Write-Host "    Synonyms:" -ForegroundColor Green
                                $syns | Select-Object -First 10 | ForEach-Object { Write-Bullet $_ -Color White -Indent 6 }
                            }

                            # Near synonyms
                            $nearSyns = @()
                            if ($senseData.near_list) {
                                foreach ($ng in $senseData.near_list) {
                                    foreach ($s in @($ng)) { if ($s.wd) { $nearSyns += $s.wd } }
                                }
                            }
                            if ($nearSyns.Count -gt 0) {
                                Write-Host ""
                                Write-Host "    Near synonyms:" -ForegroundColor DarkGreen
                                $nearSyns | Select-Object -First 8 | ForEach-Object { Write-Bullet $_ -Color Gray -Indent 6 }
                            }

                            # Antonyms
                            $ants = @()
                            if ($senseData.ant_list) {
                                foreach ($ag in $senseData.ant_list) {
                                    foreach ($a in @($ag)) { if ($a.wd) { $ants += $a.wd } }
                                }
                            }
                            if ($ants.Count -gt 0) {
                                Write-Host ""
                                Write-Host "    Antonyms:" -ForegroundColor Red
                                $ants | Select-Object -First 8 | ForEach-Object { Write-Bullet $_ -Color DarkRed -Indent 6 }
                            }

                            # Near antonyms
                            $nearAnts = @()
                            if ($senseData.nearant_list) {
                                foreach ($na in $senseData.nearant_list) {
                                    foreach ($a in @($na)) { if ($a.wd) { $nearAnts += $a.wd } }
                                }
                            }
                            if ($nearAnts.Count -gt 0) {
                                Write-Host ""
                                Write-Host "    Near antonyms:" -ForegroundColor DarkRed
                                $nearAnts | Select-Object -First 8 | ForEach-Object { Write-Bullet $_ -Color DarkGray -Indent 6 }
                            }

                            Write-Host ""
                        }
                    }
                }
            }
        }
    }
}

#endregion

Write-Host ""
Write-Host "  ─────────────────────────────────────────────────" -ForegroundColor DarkGray
Write-Host "  Data from Merriam-Webster  •  dictionaryapi.com" -ForegroundColor DarkGray
Write-Host ""
