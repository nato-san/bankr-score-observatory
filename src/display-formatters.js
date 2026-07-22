export function formatUsername(value) {
  if (value == null) return "";
  return String(value).replace(/^@+/, "");
}

const OVERALL_FIXED_DIGITS = 4;
const OVERALL_TINY_DIGITS = 6;

function finiteNumber(value) {
  if (value == null) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeZero(value) {
  return Object.is(value, -0) ? 0 : value;
}

export function formatOverallScore(value) {
  const number = finiteNumber(value);
  if (number == null) return "unavailable";
  const formatted = normalizeZero(number).toFixed(OVERALL_FIXED_DIGITS);
  return formatted === "-0.0000" ? "0.0000" : formatted;
}

export function formatOverallDiff(value) {
  const number = finiteNumber(value);
  if (number == null) return "unavailable";
  const normalized = normalizeZero(number);
  if (normalized === 0) return "+0.0000";

  const sign = normalized > 0 ? "+" : "-";
  const absolute = Math.abs(normalized);
  const fixed = absolute.toFixed(OVERALL_FIXED_DIGITS);
  if (Number(fixed) !== 0) return `${sign}${fixed}`;
  return `${sign}${absolute.toFixed(OVERALL_TINY_DIGITS)}`;
}
