export function parseBridgeUrl(value) {
  const fallback = "http://127.0.0.1:8787";
  let parsed;
  try {
    parsed = new URL(value?.trim() || fallback);
  } catch {
    throw new Error(`Invalid phone bridge address. In extension Options, use ${fallback}.`);
  }
  if (parsed.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(parsed.hostname) || parsed.username || parsed.password) {
    throw new Error(`Unsupported phone bridge address (${parsed.hostname}). In extension Options, use ${fallback}. The phone uses the separate Wi-Fi link.`);
  }
  return parsed.origin;
}
