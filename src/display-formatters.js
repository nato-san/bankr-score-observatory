export function formatUsername(value) {
  if (value == null) return "";
  return String(value).replace(/^@+/, "");
}
