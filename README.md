# formula-sentry

Catches spreadsheet formulas that leaked into a CSV export instead of the
values they compute.

## the problem

Export a sheet to CSV and, more often than you'd expect, some cells come out
as `=VLOOKUP(A2,Sheet2!A:B,2,FALSE)` instead of the looked-up value. Usually
it's someone forgetting to "paste as values" before exporting, or a script
that dumps the underlying cell content instead of the calculated result.
Nothing about a CSV file stops this — a formula string and a normal string
look identical to whatever imports the file next, until it tries to parse a
number column and finds `=SUM(B2:B40)` in it.

formula-sentry scans a CSV file cell by cell and reports every one that still
holds formula syntax, so you catch it before it hits a database import, a
billing pipeline, or another spreadsheet. It also flags two specific
sub-cases that are worth knowing about separately:

- **volatile functions** (`NOW`, `RAND`, `OFFSET`, `INDIRECT`, ...) — these
  recompute on every edit or depend on the moment they were evaluated, so the
  captured value is closer to a random snapshot than a fact.
- **external workbook references** (`[Budget2024.xlsx]Sheet1!A1`) — these
  point at a file the CSV consumer will never have.

The whole file is read as a stream. A CSV row can span multiple chunks (a
quoted field can contain literal newlines), so the parser is a small state
machine that carries partial fields and rows across chunk boundaries rather
than reading everything into a buffer first. That's the part that matters
here: a 20 GB export should scan in roughly constant memory.

## usage

Build once:

```
tsc
```

(any recent TypeScript compiler works — there's no project-specific config
beyond tsconfig.json)

Run against a file:

```
node dist/cli.js exported_report.csv
```

Or pipe it in:

```
cat exported_report.csv | node dist/cli.js
```

If the file has no header row, add `--no-header` so column numbers are
reported instead of column names.

Add `--json` to get machine-readable output instead, for a CI step that wants
to parse results rather than grep them:

```
node dist/cli.js --json exported_report.csv
```

```json
{
  "rowsScanned": 200,
  "cellsScanned": 1800,
  "formulasFound": 3,
  "volatileFound": 1,
  "externalRefsFound": 1,
  "findings": [
    {
      "row": 14,
      "column": "Total Revenue",
      "value": "=SUM(B2:B13)",
      "functions": ["SUM"],
      "volatileFunctions": [],
      "externalReference": false
    }
  ]
}
```

Sample output (default, human-readable mode):

```
row 14, Total Revenue: =SUM(B2:B13)
row 22, Last Updated: =NOW()  [volatile: NOW]
row 31, Region Lookup: =VLOOKUP(A31,[Budget2024.xlsx]Sheet1!A:B,2,0)  [external workbook reference]

rows scanned: 200
cells scanned: 1800
formulas found: 3
volatile formulas: 1
external workbook references: 1
```

The process exits with status 1 if any formula was found, so it can be
wired into a CI step or a pre-import check without extra scripting.

## scope

This looks for the literal `=...` formula pattern in cell text — it doesn't
evaluate formulas or understand spreadsheet semantics. That's deliberate;
the point is to catch data that shouldn't be there, not to build a formula
engine.
