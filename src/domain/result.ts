// Refusals are returned, not thrown. A thrown refusal is one the compiler cannot
// insist the caller handles, and every boundary in this service has a caller that
// must report the reason rather than propagate it.

export type Parsed<T> = { ok: true; value: T } | { ok: false; reason: string };
export type ParsedAll<T> = { ok: true; value: T } | { ok: false; errors: string[] };

export const ok = <T,>(value: T): Parsed<T> => ({ ok: true, value });
export const no = <T,>(reason: string): Parsed<T> => ({ ok: false, reason });

export const okAll = <T,>(value: T): ParsedAll<T> => ({ ok: true, value });
export const noAll = <T,>(errors: string[]): ParsedAll<T> => ({ ok: false, errors });
