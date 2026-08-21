import { compositePatterns } from "./patterns-composite";
import { flexPatterns } from "./patterns-flex";
import { gridPatterns } from "./patterns-grid";

export const COMPARE_PATTERNS = [...flexPatterns, ...gridPatterns, ...compositePatterns];

export const COMPARE_PATTERN_BY_ID = new Map(
  COMPARE_PATTERNS.map((pattern) => [pattern.id, pattern]),
);
