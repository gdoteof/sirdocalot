// The serialisable subset. Widget definitions live in a database and arrive over
// HTTP, so anything the registry holds has to survive that round trip unchanged.

export type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

export function isJsonObject(v: Json | undefined): v is { [key: string]: Json } {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

// Dotted path into a scope. Returns undefined for a miss rather than throwing,
// because a template referring to a prop that was not supplied is a validation
// failure to be reported with the others, not an exception mid-render.
export function resolvePath(scope: Readonly<Record<string, Json>>, path: string): Json | undefined {
  const segments = path.split(".");
  let current: Json | undefined = scope[segments[0] ?? ""];
  for (const segment of segments.slice(1)) {
    if (current === undefined || current === null) return undefined;
    if (Array.isArray(current)) {
      const index = Number(segment);
      current = Number.isInteger(index) ? current[index] : undefined;
    } else if (typeof current === "object") {
      current = current[segment];
    } else {
      return undefined;
    }
  }
  return current;
}
