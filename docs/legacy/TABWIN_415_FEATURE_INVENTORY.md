# TabWin 4.15 — feature inventory and compatibility matrix

## Evidence and scope

This inventory was rebuilt on 2026-08-26 from the project-owner-supplied
TabWin 4.15 distribution. The WinHelp contents index (`TABWIN32.CNT`) contains
17 sections and 150 named help topics. `DocTabWin.htm`, `defcnv.htm`,
`HISTORIA.TXT`, the shipped maps and the existing architecture documents were
used as supporting evidence.

The catalog is complete at the **named help-topic level**. It is not a claim
that every topic's detailed computational behavior has been specified or
implemented. Each family below distinguishes those states explicitly.

Status vocabulary:

- **Web** — usable through the browser UI;
- **Kernel** — implemented behind `AnalysisSpec -> QueryPlan -> Executor`, but
  not yet fully surfaced in the UI;
- **Parsed** — input is read and preserved, but execution may remain guarded;
- **Cataloged** — confirmed in 4.15 help; behavioral oracle work remains;
- **Replaced** — the user outcome stays, but an obsolete mechanism will not be
  recreated literally.

## 1. Source opening and tabulation

| TabWin capability | Web status | Notes |
| --- | --- | --- |
| Open `.DBC` and `.DBF` | **Web** | Browser-compatible decoder; no upload. |
| Search/download official microdata | **Web / modern extension** | Official DATASUS catalog, system/type/year/month/UF filters, official HTTPS preparation and local opening. Not a claimed 4.15 compatibility behavior. |
| Resolve official DEF/CNV auxiliaries | **Web / partial** | Verified SIH-RD rule downloads current `TAB_SIH.zip` and loads `RD2008.DEF` plus referenced CNVs. Other systems remain explicit pending rules. |
| Select `.DEF` | **Web / Parsed** | `A`, `R`, `S/L/C/Q/D/T/X`, `I`, `G`, `?`; `X` = row+column+selection (RE-002). Panel built from the DEF in file order. |
| Apply `.CNV` | **Web / Kernel** | Legacy short, literal and numeric-range forms; source-order precedence retained. New `N` layout remains guarded. |
| Row and column dimensions | **Web** | Raw rows/columns; row CNV in the current UI. |
| Frequency | **Web** | Ordinary and `G` weighted frequency in kernel. |
| G001: one CNV-backed row, frequency | **Golden** | Exact TabWin 4.15 BIFF comparison passed with tolerance zero. |
| Increment / sum | **Web / Kernel** | Numeric and DEF increment labels surfaced; compiled as explicit sum measure. Total policies remain pending. |
| Selections / filters | **Web / Kernel** | Multiple simultaneous raw or DEF/CNV-backed inclusion/exclusion filters, explicit numeric intervals and selection-all/clear controls. Exact 4.15 dialog defaults remain golden-pending. |
| Suppress zero rows | **Web** | Applied after materializing CNV categories. |
| Row subtotals | **Kernel** | CNV subtotal propagation tested. |
| Tabulate list of files | **Web** | Panel "Arquivos" list: choose which open files enter the tabulation (log and saved records follow). |
| Value ranges | **Web / Kernel** | Numeric-range CNV plus explicit open/closed filter bounds in the browser. |
| Top `n` categories | **Cataloged** | Must define tie/order semantics from the oracle. |
| Unclassified data | **Web / oracle-checked** | Ignorar/Incluir/Discriminar as TabWin: Incluir = one `Não classificados` row/column; Discriminar = one row per unmatched code on literal CNV/DBF lookups, first-appearance order, ignored on short CNV (RE-002, `verify:painel`). |
| Log file | **Web** | TabWin log written after each panel run; pasted log or `.TAB` restores the panel (RE-002). |

## 2. Tables, saved work and exports

| Capability family | Web status | Named 4.15 topics |
| --- | --- | --- |
| Open/save table | **Web `.twtable` + recipe / Cataloged `.TAB`** | Portable results reopen without the source DBC and retain operations/presentation; `.twrecipe` re-executes against data. Legacy `.TAB` parsing remains pending. |
| Print | **Cataloged** | Print table. Browser print stylesheet pending. |
| Export | **Web (CSV/XML/XLSX)** | Complete result matrix, provenance-aware XML and two-sheet XLSX with audit metadata; DBF, Parquet and legacy formats pending. |
| Copy/paste/include table | **Web copy / Cataloged paste+include** | Current presented rows copy as spreadsheet-ready TSV; paste and table inclusion semantics pending. |
| Save selected records as DBF | **Web / golden-pending** | The executor's accepted record set is written as standard local xBase DBF; exact 4.15 dialog/schema defaults need an oracle artifact. |
| Audit/recipe | **Web / Kernel** | QueryPlan and hashes visible; deterministic recipe save/open validates plans and fingerprints. |

## 3. Table calculations

All of the following are confirmed by individual help topics. They must become
explicit, replayable result transforms and must never mutate the source
`QueryPlan` silently.

| Operation | Status |
| --- | --- |
| Indicator calculation | **Web** — TabWin `Calcular indicador`: numerator × 10ⁿ ÷ denominator (scale 1…1,000,000), zero on zero denominator, precalculated total = ratio of totals (decompiled, RE-002). |
| Add two or more columns | **Web** — TabWin `Somar` over 2+ columns at once (header `Soma`, total = sum of column totals), manual do curso TabWin, SESAP-RN/COSEMS-RN, fev/2011, p. 49. |
| Subtract, multiply or divide two columns | **Web** — headers `Diferença`, `Produto`, `Quociente`; Produto/Quociente default to a precalculated total = the same operation on the column totals (manual, p. 50). Division-by-zero behavior is explicit (`error` or `zero`). |
| Minimum and maximum | **Web** — over 2+ columns, headers `Menor` / `Maior` (manual, p. 51–52). |
| Multiply by a factor | **Web / modern policy** |
| Percentage | **Web** — `A / B × 100` (modern) and TabWin `%percentagem` (value ÷ column total × 100, header `%`), decompiled. |
| Normalize | **Web** — TabWin `Normalizar`: z-score with sample SD (n − 1), header `Z`, decompiled (RE-002). |
| Accumulate a column | **Web / modern policy** — current result row order is authoritative. |
| Absolute value and integer values | **Web / modern policy** — UI integer conversion uses truncation toward zero; kernel also represents round/floor/ceil. |
| Define sequence | **Web** — header `Seqüência`; with a column sort active, rows are numbered by rank in that order (the manual's "n largest categories", p. 54). |
| Recalculate total / change total type | **Web** — `set-total-policy` on any column: none, sum, product, mean, initial, final, min, max, and precalculated (freezes the total shown now). Recalcula total = back to sum (manual, p. 54, 57–58). |
| Insert a new column | **Web** — constants and safe expressions support `c1`/`C01`, exact keys, bracketed titles, parentheses and `+ - * / ^`; TabWin form `Título=c2/c1`, and a trailing `,00` (`Percentagem=c2/c1*100,00`) fixes the column's decimal places (manual, p. 55–56). |

All implemented transforms are immutable, replayable and shown in the Audit
view. They sit after `TabulationResult`; none silently rewrites the source
`AnalysisSpec` or `QueryPlan`. The operation family is not marked golden until
focused TabWin 4.15 reference cases establish defaults, rounding and edge cases.

## 4. Table presentation

| Presentation capability | Status |
| --- | --- |
| Sort values | **Web** — original, ascending and descending by key or numeric column; clicking a column header sorts descending, a second click ascending, as TabWin does (manual, p. 56). Stable and non-mutating. |
| Decimal places | **Web** — table-wide automatic or 0–6, plus per-column places (`set-decimals`, TabWin `Quadro → Decimais`) used while the table is on automatic. Negative values show in red, except in the total row. |
| Show/hide key | **Web / modern presentation** — sticky key remains the default. |
| Locate row/category | **Web / modern presentation** — accent-insensitive key and label search. |
| Print table | **Web / modern presentation** — dedicated browser print stylesheet. |
| Alter column header and width | **Web (header)** — rename-column. Width: the browser sizes columns; not reproduced. |
| Delete and move columns | **Web / modern policy** — rename, move left/right and remove are immutable recipe operations; the final numeric column cannot be deleted. |
| Suppress/aggregate rows | **Web** — TabWin criterion form: column, igual a / maior que / menor que / diferente de, value, optional aggregate row labelled `Outras` (manual, p. 58–59); locate-based selection also kept. Reversible and audited. |
| Fix key length | **Web** — `include-table.keyLength` compares only the first N characters of each row key (7-digit TabNet IBGE code vs 6-digit TabWin, manual p. 59–60). |
| Edit two table headers / insert footnote | **Web** — Título, Subtítulo and Rodapé in Quadro. |

Sorting, decimals and key visibility persist in recipes and appear in Audit.
The locate query intentionally does not persist because it is transient UI
state. Modern presentation may differ visually, but every operation that
changes data remains separate from purely visual sorting or formatting.

## 5. Charts

| Chart or operation | Status |
| --- | --- |
| Horizontal bars | **Web** | First responsive chart view, driven by the current `TabulationResult`. |
| Lines | **Web** | SVG renderer over current result; legacy display options still need oracle cases. |
| Vertical bars | **Web** | SVG renderer over current result. |
| Pie / sectors | **Web** | Top positive categories with explicit percentages. |
| Areas | **Web** | SVG area/line renderer over source row order. |
| Points / scatter | **Web** | Point view over row position and value; expert axis binding remains pending. |
| Bubbles | **Web** | Bubble size derives from result magnitude. |
| Arrows | **Web** | Requires two or more columns and displays first-to-last change; distinct from map flows. |
| Empty chart / add chart type | **Cataloged** | Composition workflow pending. |
| Edit background, title font, legend and display options | **Cataloged** | Will be expressed as portable view settings. |
| Edit axes, zoom and zoom reset | **Cataloged** | Touch/keyboard behavior required on web. |
| 3D effect | **Cataloged / likely historical** | Compatibility option only if it changes an exported artifact users still need. |
| Background image | **Cataloged** | Local-only image input if retained. |
| Copy, print and save chart | **Web (PNG/SVG) / Cataloged** | Every current chart family exports PNG and SVG; browser print remains pending. |

## 6. Maps and geographic analysis

| Capability | Status | Notes |
| --- | --- | --- |
| Open TabWin `.MAP` | **Web / Parsed** | Version 1.00 parser validated on the supplied UF and 5,570-municipality maps. |
| Choropleth from table | **Web** | Canvas renderer associates result keys or labels locally. |
| Bundled municipality and UF maps | **Web** | A DBC geographic row can map without a second download. |
| Equal interval / equal frequency classes | **Web** | Continuous, equal-interval and quantile/equal-frequency presentations are explicit; exact legacy break/rounding semantics remain pending. |
| Edit class count, limits, colors and palette | **Web / Partial** | Class count and four accessible palettes persist in recipes; manual limits and individual colors remain pending. |
| Zoom, pan and repaint | **Web** | Buttons, wheel/touchpad zoom, pointer/touch pan and reset are available. |
| Borders, seats, names and values | **Parsed / Cataloged** | MAP seat/type and label coordinates retained; display controls pending. |
| Select areas / obtain information | **Web / Partial** | Local polygon hit testing identifies name/code and associated value; selection-to-filter bridge remains pending. |
| Add/remove layers and new base map | **Cataloged** | Must remain local-first. |
| Distance column | **Cataloged** | Geographic formula and projection handling require oracle evidence. |
| Origin–destination flows | **Cataloged** | Help confirms flow table, arrows, origin/destination totals and sector charts. |
| Import E00, SHP, BNA, BND, MIF/MID, XY, WPT, GPX, MME, SPRING | **Cataloged** | Demand-driven adapters; modern GeoJSON/GeoPackage may be offered alongside them. |
| Copy, print, bitmap and KML-related export | **Web (PNG) / Cataloged** | Current canvas map exports PNG; GeoJSON/KML, print and compatibility formats remain explicit future work. |

## 7. Statistical analysis

Four named operations are confirmed and now have an initial **Web** surface:

1. descriptive statistics for one column;
2. Pearson correlation coefficient;
3. simple linear regression;
4. histogram analysis.

They operate over columns of the current `TabulationResult`, persist their view
settings in recipes and are labeled as modern calculations. Each still needs
golden numerical cases, including missing-value, population/sample and rounding
policy, before compatibility claims.

## 8. DEF/CNV authoring and DBF utilities

Confirmed topics include concepts, edit and create flows for DEF/CNV; DBF
viewer (**Web**: "Ver registros do arquivo"); DBF compression to DBC; DBC expansion; CRC test; accent conversion;
and saving records to a new DBF. Reading/parsing, DBC expansion and
executor-selected record writing are now **Web**. DBF-to-DBC encoding,
authoring and accent conversion remain **Cataloged**; CRC testing is **Web**
(CRC-32 of the decompressed DBF, RE-002).

## 9. Integrations and historical mechanisms

| Capability | Decision |
| --- | --- |
| TabWin + R analysis schemes | **Cataloged** as an expert workflow. A browser-safe recipe/plugin boundary is preferred; arbitrary local R cannot run on GitHub Pages. |
| TabWin + SQL saved queries | **Cataloged**. DuckDB/WASM may execute compiled plans later but must not define legacy semantics. |
| XML/SDF/CSV/DBF import | **Web CSV/TSV / Cataloged others**; delimited input runs under the modern profile and does not claim legacy importer defaults. |
| Wine instructions | **Replaced** by the native browser application. |
| BDE, WinHelp, Registry discovery, WMF-first graphics, FTP browser assumptions | **Replaced**; do not recreate. |

## Next compatibility slices

1. Move DBC decoding to a cancellable Web Worker and benchmark mobile memory.
2. Surface remaining DEF-driven columns, increments and selection modes in the UI.
3. Continue `.TAB` archaeology and add explicit result transforms; portable recipe save/open is now Web.
4. Complete legacy map classes, labels, layers and selection bridging.
5. Establish focused goldens for statistics, saved `.TAB`, DBF subsets and
   origin–destination flow.


## Help do TabWin v2 (versão impressa) — conferência de 2026-10-14

| Função | Status |
| --- | --- |
| CNV de código curto (letra na 1ª posição, branco) | **Web, medido** — RE-003: o código vira número (A = 1 … Z = 26, não-dígito fora da 1ª posição = 0, branco = 000), igual para dado e CNV. O Help diz "A a J = 0 a 9"; o programa real faz diferente. |
| Gera DEF a partir dos campos do DBF | **Web** — texto → `X` + CNV do campo, número → `I`. O texto exato que o TabWin gera não foi capturado. |
| Gera CNV a partir dos campos / Numera CNV | **Web** — uma categoria por código existente; renumeração mantém subtotais. |
| Regressão: coluna de estimados | **Web** — Nova coluna por expressão (intercepto + inclinação × X). |
| Histograma: intervalos iguais / igual freqüência | **Web** — "Manual" (limites digitados) não reproduzido. |
| Notas técnicas, colar tabela, `.LST` | **Cataloged** |
