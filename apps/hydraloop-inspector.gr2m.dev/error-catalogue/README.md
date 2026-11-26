# Hydraloop H600 troubleshooting metadata

Structured JSON export of the Hydraloop troubleshooting reference database, reviewed **2026-11-07**. This export is based on the Excel workbook `hydraloop_h600_troubleshooting_database.xlsx` and includes every data record and column in its five data tabs. The workbook's **Read Me** tab is represented by this document.

## Files

| File               | Rows | Description                                                                                                                               | Primary key               |
| ------------------ | ---: | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| `errors.json`      |   28 | Code, title, summary, urgency, subsystem, H600 applicability and revision notes, official article links, and associated-component summary | `code`                    |
| `causes.json`      |   73 | Potential causes, what to check, suggested actions, conditions, associated parts and supporting links                                     | `cause_id`                |
| `parts.json`       |   57 | Deduplicated functional components/subsystems, their hardware-version caveats, and notes                                                  | `part_id`                 |
| `error_parts.json` |  118 | Many-to-many error–component mapping, component relationship and related cause text                                                       | (`error_code`, `part_id`) |
| `coverage.json`    |    9 | Decisions about included, excluded, linked-only and unpublished catalogue entries                                                         | None                      |

Each JSON file contains a **top-level array of objects**, preserving its source table's column names. All rows are included. Numerical counts are JSON numbers; empty cells are JSON `null`; other values remain strings. Unicode component names and full source URLs are preserved. Where the workbook stores a semicolon-separated summary of components in a cell (`errors.parts`, `causes.parts`), this export preserves that original text rather than treating it as the authoritative linkage.

## Relationships

- `errors.code` → `causes.error_code` (one-to-many).
- `errors.code` → `error_parts.error_code` (one-to-many).
- `parts.part_id` → `error_parts.part_id` (one-to-many).
- Use `error_parts` to find parts implicated in an error, or to find all errors associated with a part.
- `parts.part_id` values are **database identifiers**, not manufacturer part numbers or ordering SKUs.

Example, in Python (standard library only):

```python
import json
from pathlib import Path

root = Path('hydraloop_h600_troubleshooting_json')
errors = json.loads((root / 'errors.json').read_text(encoding='utf-8'))
parts = json.loads((root / 'parts.json').read_text(encoding='utf-8'))
links = json.loads((root / 'error_parts.json').read_text(encoding='utf-8'))

code = 'HL0018'
error = next(row for row in errors if row['code'] == code)
part_by_id = {row['part_id']: row for row in parts}
related_parts = [part_by_id[row['part_id']] for row in links if row['error_code'] == code]
print(error['title'])
for part in related_parts:
    print(part['part_id'], part['name'])
```

## Coverage and model applicability

The dataset contains **27 numbered HL error-code records** plus **one general, non-numbered `QUALITY` record** (bad water quality). It includes catalogue entries with **explicit H600 applicability** or shared Hydraloop architecture that may also apply to the H600. The public catalogue does not systematically tag articles with device-model compatibility, so **“shared architecture” does not independently confirm H600 compatibility**. See `errors.h600_applicability`, `errors.revision_caveat`, `parts.revision`, and `coverage.json` before drawing model-specific conclusions.

The article for **HL0004 / HL0032** covers two distinct code records; both are retained. Codes absent from the publicly listed catalogue were not fabricated; those absences are tracked in `coverage.json`. `QUALITY` is a troubleshooting topic, not an `HLxxxx` error code.

## Component-label caveats

The parts list contains **functional components, assemblies, paths, sensors and site equipment**, not a verified manufacturer bill of materials. Hydraloop internal labels like **x6**, **x42**, **x10**, and **x12** identify article-referenced components and are **not** confirmed replacement SKUs. The H600 has a side-B transfer component referred to as **x42** in the HL0009 article. Some parts or instructions differ between **V1.x** and **V2.x** hardware. Optional upstream/downstream equipment applies only if installed at your site.

The `kind` field in `error_parts.json` expresses the relationship of a component to the error; it does not necessarily mean that the part is defective or needs replacement. Suggested actions are condensed troubleshooting reference material, **not verified repair instructions** or authorization to perform electrical/plumbing repairs.

## Source, date and safety

- Official troubleshooting index: https://info.hydraloop.com/troubleshooting/
- Hydraloop 2026 owner manual: https://info.hydraloop.com/manuals/2026-hydraloop-owners-manual
- Hydraloop 2026 maintenance guide: https://info.hydraloop.com/manuals/2026-hydraloop-maintenance-guide
- Solenoid valve service guide: https://info.hydraloop.com/manuals/replace-clean-the-inside-of-a-solenoid-valve/
- Every problem and cause retains its official `source_url`. Numbered codes also have a `short_link` when available.
- Source-article update dates, when available, are preserved in `errors.source_updated`; database-review dates in `errors.reviewed`.

If inspecting an actual fault, follow the applicable manufacturer instructions and use qualified service personnel for electrical, water-leak, and internal component work. In particular, HL0017 instructions warn to turn off backup-water feed immediately.
