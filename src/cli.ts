#!/usr/bin/env node
import { createReadStream } from 'node:fs';
import { parseCsvStream } from './csvStream.js';
import { analyzeCell } from './formulaRules.js';

interface Options {
  filePath: string | null; // null means read from stdin
  hasHeader: boolean;
}

function parseArgs(argv: string[]): Options {
  let hasHeader = true;
  let filePath: string | null = null;

  for (const arg of argv) {
    if (arg === '--no-header') {
      hasHeader = false;
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

  return { filePath, hasHeader };
}

function printUsage(): void {
  process.stdout.write(
    'usage: formula-sentry [--no-header] <file.csv>\n' +
      '       cat file.csv | formula-sentry [--no-header]\n',
  );
}

function columnLabel(headers: string[] | null, index: number): string {
  if (headers && headers[index] !== undefined) return headers[index];
  return `column ${index + 1}`;
}

async function main(): Promise<void> {
  const { filePath, hasHeader } = parseArgs(process.argv.slice(2));

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
      const flags: string[] = [];
      if (finding.volatileFunctions.length > 0) {
        volatileFound++;
        flags.push(`volatile: ${finding.volatileFunctions.join(', ')}`);
      }
      if (finding.externalReference) {
        externalRefsFound++;
        flags.push('external workbook reference');
      }

      const suffix = flags.length > 0 ? `  [${flags.join('; ')}]` : '';
      process.stdout.write(`row ${rowsScanned}, ${label}: ${row[col]}${suffix}\n`);
    }
  }

  process.stdout.write(
    '\n' +
      `rows scanned: ${rowsScanned}\n` +
      `cells scanned: ${cellsScanned}\n` +
      `formulas found: ${formulasFound}\n` +
      `volatile formulas: ${volatileFound}\n` +
      `external workbook references: ${externalRefsFound}\n`,
  );

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
