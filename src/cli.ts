#!/usr/bin/env node
import { createReadStream } from 'node:fs';
import { parseCsvStream } from './csvStream.js';
import { analyzeCell } from './formulaRules.js';

interface Options {
  filePath: string | null; // null means read from stdin
  hasHeader: boolean;
  jsonOutput: boolean;
}

function parseArgs(argv: string[]): Options {
  let hasHeader = true;
  let jsonOutput = false;
  let filePath: string | null = null;

  for (const arg of argv) {
    if (arg === '--no-header') {
      hasHeader = false;
    } else if (arg === '--json') {
      jsonOutput = true;
    } else if (arg === '-h' || arg === '--help') {
      printUsage();
      process.exit(0);
    } else if (!arg.startsWith('-')) {
      filePath = arg;
    } else {
      process.stderr.write(`unknown option: ${arg}\n`);
      process.exit(1);
    }
  }

  return { filePath, hasHeader, jsonOutput };
}

function printUsage(): void {
  process.stdout.write(
    'usage: formula-sentry [--no-header] [--json] <file.csv>\n' +
      '       cat file.csv | formula-sentry [--no-header] [--json]\n',
  );
}

interface JsonFinding {
  row: number;
  column: string;
  value: string;
  functions: string[];
  volatileFunctions: string[];
  externalReference: boolean;
}

function columnLabel(headers: string[] | null, index: number): string {
  if (headers && headers[index] !== undefined) return headers[index];
  return `column ${index + 1}`;
}

async function main(): Promise<void> {
  const { filePath, hasHeader, jsonOutput } = parseArgs(process.argv.slice(2));

  if (filePath === null && process.stdin.isTTY) {
    printUsage();
    process.exit(1);
  }

  const input = filePath === null ? process.stdin : createReadStream(filePath);

  let headers: string[] | null = null;
  let rowsScanned = 0;
  let cellsScanned = 0;
  let formulasFound = 0;
  let volatileFound = 0;
  let externalRefsFound = 0;
  const jsonFindings: JsonFinding[] = [];

  for await (const row of parseCsvStream(input)) {
    rowsScanned++;

    if (hasHeader && headers === null) {
      headers = row;
      continue;
    }

    for (let col = 0; col < row.length; col++) {
      cellsScanned++;
      const finding = analyzeCell(row[col] as string);
      if (!finding.isFormula) continue;

      formulasFound++;
      const label = columnLabel(headers, col);
      if (finding.volatileFunctions.length > 0) volatileFound++;
      if (finding.externalReference) externalRefsFound++;

      if (jsonOutput) {
        jsonFindings.push({
          row: rowsScanned,
          column: label,
          value: row[col] as string,
          functions: finding.functions,
          volatileFunctions: finding.volatileFunctions,
          externalReference: finding.externalReference,
        });
        continue;
      }

      const flags: string[] = [];
      if (finding.volatileFunctions.length > 0) {
        flags.push(`volatile: ${finding.volatileFunctions.join(', ')}`);
      }
      if (finding.externalReference) {
        flags.push('external workbook reference');
      }

      const suffix = flags.length > 0 ? `  [${flags.join('; ')}]` : '';
      process.stdout.write(`row ${rowsScanned}, ${label}: ${row[col]}${suffix}\n`);
    }
  }

  if (jsonOutput) {
    process.stdout.write(
      JSON.stringify(
        {
          rowsScanned,
          cellsScanned,
          formulasFound,
          volatileFound,
          externalRefsFound,
          findings: jsonFindings,
        },
        null,
        2,
      ) + '\n',
    );
  } else {
    process.stdout.write(
      '\n' +
        `rows scanned: ${rowsScanned}\n` +
        `cells scanned: ${cellsScanned}\n` +
        `formulas found: ${formulasFound}\n` +
        `volatile formulas: ${volatileFound}\n` +
        `external workbook references: ${externalRefsFound}\n`,
    );
  }

  // Non-zero exit lets this run as a CI check: fail the build if a formula
  // slipped into a CSV export that's supposed to hold flat data.
  if (formulasFound > 0) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  process.stderr.write(`formula-sentry: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
