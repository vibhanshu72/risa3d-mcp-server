# Changelog

All notable changes to the RISA-3D MCP Server are documented here.

---

## [1.7.0] - 2025-06

### Added

**Tool 24 -- `export_to_saf`**
Exports a RISA-3D model to SAF (Structural Analysis Format), the open Excel-based exchange standard developed by the Nemetschek Group. SAF is supported by SCIA Engineer, SOFiSTiK, AxisVM, Dlubal RFEM, and a growing list of structural analysis software. This tool reads the `.r3d` file directly and produces a compliant `.xlsx` file without requiring RISA to be open.

Five sheets are produced: StructuralMaterial (steel material properties in SI units), StructuralCrossSection (one row per named section set), StructuralPointConnection (all nodes with coordinates converted to meters), StructuralCurveMember (all members with node references and cross-section assignments), and StructuralPointSupport (boundary conditions mapped to SAF Fixed/Free per DOF). A sixth NOTES sheet documents the two key limitations explicitly rather than hiding them.

Two limitations are clearly documented in the output:

Limitation 1 -- Units: RISA-3D uses feet. SAF requires meters. All node coordinates are automatically converted using 1 ft = 0.3048 m.

Limitation 2 -- Vertical axis: RISA-3D uses Y as the vertical axis. SAF and most receiving software (SCIA, SOFiSTiK, AxisVM) expect Z as vertical. This tool does NOT swap the Y and Z axes automatically, because doing so changes model geometry and is a deliberate engineering decision, not a mechanical conversion. RISA itself requires a Y-to-Z axis change before its own native SAF export for the same reason. The NOTES sheet in the output file explains this clearly for anyone receiving the file.

Loads are not included in this export. SAF supports load transfer, but RISA's load format requires additional parsing not yet implemented.

---

## [1.6.0] - 2025-06

### Added

**Tool 23 -- `add_member`**
Adds a new member to the model and saves a new `.r3d` file. This is the first tool that can introduce new geometry rather than only modify existing values.

Key design decisions, based on raw format confirmed across two different real project models with completely different geometry:

The NODES section uses scientific notation (e.g. 1.200000000000e+01), a different numeric format from MEMBERS_MAIN_DATA which uses plain decimals. New node lines are written in the correct scientific notation format to match.

Every node line ends in a fixed trailing block (0.000000000000e+00 65535 0 0 -1 -1 0) that was verified identical across 300+ node lines in two unrelated models, so it is treated as a confirmed constant and copied verbatim rather than guessed.

Members reference nodes by their 1-based position in the NODES list, not by label. New nodes are always appended to the end of the NODES block so no existing member's node reference ever shifts position.

New member lines clone the full trailing field structure (orientation and release codes, which vary by member type and are not fully understood) from an existing member of the same type already in the model. If no member of the requested type exists yet, the tool refuses rather than guessing the field structure, and reports which types are available instead.

Header counts are recalculated by actual line count after the edit, never by manual increment, to eliminate off-by-one risk.

Accepts either two existing node labels, or coordinates for one or both new nodes, never an ambiguous mix of both for the same end. Always saves as a new file and never overwrites the original.

### Fixed during development

A double-semicolon bug was caught and fixed before release: the file's quote-aware tokenizer does not separate the trailing semicolon from the final field on a line, so naively reusing a tokenized trailing-fields block and appending another semicolon produced "0;;" in generated node lines. The fix strips the existing trailing semicolon before reassembly. Caught via isolated testing against the real confirmed file format before any user-facing deployment.

---

## [1.5.0] - 2025-06

### Added

**New dependency: `xlsx` package.** Tools 21 and 22 require the `xlsx` npm package. Run `npm install xlsx` in the `C:\risa-mcp` folder before using these two tools (existing installs need this one-time step; the README install instructions now include it for new setups).

**Tool 19 -- `get_material_takeoff`**
Returns total weight by section size and a grand total across the model. Weight per foot for Wide Flange and Channel shapes is read directly from the AISC designation (the number after the X, e.g. W14X22 = 22 lb/ft). HSS and angle shapes use an embedded lookup table since their designation describes dimensions, not weight. Any size not in the table is flagged as unknown and excluded from the total rather than guessed, to avoid silently wrong tonnage. The lookup table can be extended in index.js as new sizes come up.

**Tool 20 -- `find_unbraced_length_issues`**
Flags members longer than a configurable threshold (default 15 ft) for manual review. This is explicitly a length screen, not a slenderness or KL/r calculation -- it does not apply K-factors, account for intermediate brace points, or make a pass/fail determination. Output frames flagged members as candidates for engineering judgment, consistent with preferring manual review for anything requiring project-specific context.

**Tool 21 -- `export_member_schedule_to_excel`**
Writes the member schedule directly to a real `.xlsx` file at a specified output path, removing the manual copy-paste and Text-to-Columns step previously required after `export_member_schedule`.

**Tool 22 -- `batch_summarize_folder_to_excel`**
Same data as `batch_summarize_folder`, written directly to a real `.xlsx` file instead of returned as CSV text.

---

## [1.4.0] - 2025-06

### Added

**Tool 17 -- `modify_section_set`**
First write tool. Changes a section size and saves a NEW `.r3d` file, never overwriting the original. Supports three modes: change the section set definition only, change specific member assignments only, or both. Optional `setName` or `memberLabel` parameters narrow the change to a single set or member rather than every instance of a size in the model. Returns a count of sets and members changed, or a clear message if no matches were found (with no file written).

**Tool 18 -- `clone_model_with_changes`**
Saves a copy of the model with one or more changes applied in a single call: section sizes (set-level, member-level, or both), boundary conditions (per-node, per-DOF Fixed/Free), and member distributed load magnitudes (resolved by load case name). Always writes to a new file specified by `outputPath`; never overwrites the source. Useful for parametric studies, what-if comparisons, and generating revision sets without manually editing the model in RISA.

Both write tools include a hard safety check: if `outputPath` matches `filePath`, the tool refuses to run and returns an error instead of writing the file.

---

## [1.3.0] - 2025-06

### Added

**Tool 14 -- `get_load_cases`**
Lists all basic load cases defined in the model with their 1-based index, name, and load type (Gravity, Seismic, Wind, etc.). Useful for cross-referencing load case indices that appear in the load sections of the model. Complements the existing `list_load_combinations` tool (Tool 4) which covers factored combinations.

**Tool 15 -- `find_members_by_section`**
Returns all members assigned a specific section size. Accepts partial, case-insensitive matches so `"hss8"` will match `"HSS8X8X10"`. If no match is found, lists all section sizes present in the model so you can correct the query. Useful for verifying section assignments and identifying which members will be affected before making a section change.

**Tool 16 -- `get_deflection_limits`**
Returns the deflection limit ratios (L/240, L/360, etc.) from both the global deflection rules and the per-member deflection rules. Categories covered: DL, LL, TL, and cantilever variants. Shows "Not checked" for any category set to -1 in the model. Useful for peer review and design narrative documentation.

---

## [1.2.0] - 2025-06

### Added

**Tool 13 -- `batch_summarize_folder`**
Scans a folder for all `.r3d` files and returns a single CSV summary table with one row per model. Each row includes file name, model title, designer, node count, member count, section set count, load combination count, file size, and a quick QC status (flags unassigned sections and invalid node references). Optional `filterName` parameter to match only files whose name contains a specific string. Useful for project-wide QC and cross-model reporting across all stair or platform models in a project folder.

---

## [1.1.0] - 2025-06

### Added

**Tool 9 -- `get_model_materials`**
Lists all HR and CF steel materials defined in the model. Returns Grade, E (ksi), Fy (ksi), and Fu (ksi) as CSV. Useful for QC and design narrative writing.

**Tool 10 -- `get_boundary_conditions`**
Lists all constrained nodes with their support conditions. Resolves node indices to node labels, translates RISA constraint codes (4=Fixed, 0=Free, 1=Spring, etc.) to human-readable text, and adds a plain-English description column (Fixed, Pinned, or the specific combination of constraints).

**Tool 11 -- `get_section_sets`**
Lists all named hot-rolled steel section sets and their assigned types and sizes as CSV. Directly useful for design review -- shows what sections are assigned to each named group (e.g. Stringers, Posts, Hangers).

**Tool 12 -- `summarize_model_for_report`**
Single-call model summary combining project info, nodes, members, section sets, materials, boundary conditions, load combinations, area loads, distributed loads, and point loads. Replaces 6+ separate tool calls. Output is structured for pasting directly into a calculation package or design narrative.

### Changed

**`list_members` -- token efficiency refactor**
Now returns a compact type breakdown by default (e.g. "168 members total: 62 Tube, 45 Wide Flange, 38 Channel, 23 Angle"). Use `mode="full"` for full CSV detail. Optional `filterType` parameter (e.g. `"Tube"`, `"Wide Flange"`) returns only matching members.

**`export_member_schedule` -- token efficiency refactor**
Now supports optional `filterType` to export only one member type. Added `maxRows` parameter (default 200) to prevent runaway token usage on large models. Shows a warning if the result is capped.

### Fixed

**Correct load section names documented**
RISA-3D stores point/nodal loads under `[NODE_LOADS]` (not `[JOINT_LOADS]`) and member distributed loads under `[DIRECT_DISTRIBUTED_LOADS]` (not `[MEMBER_DISTRIBUTED_LOADS]`). The summarize tool and technical notes now reflect the correct section names.

---

## [1.0.0] - 2025-05

### Added

Initial release with 8 tools:

- `read_risa_model` -- project summary (title, node count, member count, file size)
- `list_members` -- all members with type, size, and resolved i/j node labels
- `list_nodes` -- all nodes with X, Y, Z coordinates
- `list_load_combinations` -- all load combination names
- `get_file_section` -- raw contents of any named file section
- `compare_risa_models` -- diff two `.r3d` files (nodes, members, section sets, load combos)
- `export_member_schedule` -- member schedule as CSV with calculated lengths
- `qc_check_risa_model` -- checks for duplicate nodes, duplicate members, missing sections, zero-length members, invalid node references

### Technical notes documented

- Fixed-width quoted fields require a quote-aware tokenizer
- Member i/j node references are 1-based positional indices into the `[NODES]` list, not label strings
