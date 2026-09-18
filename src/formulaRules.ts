export interface FormulaFinding {
  isFormula: boolean;
  functions: string[];
  volatileFunctions: string[];
  externalReference: boolean;
}

// Functions that recalculate on every edit, or depend on wall-clock time or
// cell position, rather than only on their arguments. A CSV cell holding one
// of these almost certainly captured a value that won't reproduce once the
// live spreadsheet is gone.
const VOLATILE_FUNCTIONS = new Set([
  'NOW',
  'TODAY',
  'RAND',
  'RANDBETWEEN',
  'RANDARRAY',
  'OFFSET',
  'INDIRECT',
  'CELL',
  'INFO',
]);

const FUNCTION_CALL = /([A-Za-z][A-Za-z0-9_.]*)\s*\(/g;
// Matches Excel's cross-workbook reference syntax, e.g. [Budget2024.xlsx]Sheet1!A1
const EXTERNAL_WORKBOOK_REF = /\[[^\]]+\.xls[xmb]?\]/i;

export function analyzeCell(raw: string): FormulaFinding {
  const value = raw.trim();
  if (!value.startsWith('=') || value.length < 2) {
    return { isFormula: false, functions: [], volatileFunctions: [], externalReference: false };
  }

  const functions = new Set<string>();
  for (const match of value.matchAll(FUNCTION_CALL)) {
    functions.add(match[1].toUpperCase());
  }

  const volatileFunctions = [...functions].filter((fn) => VOLATILE_FUNCTIONS.has(fn));

  return {
    isFormula: true,
    functions: [...functions],
    volatileFunctions,
    externalReference: EXTERNAL_WORKBOOK_REF.test(value),
  };
}
