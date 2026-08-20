// Agent input becomes primitive blocks here: widget references are looked up and
// expanded, everything else is taken as a primitive block, and the whole list is
// parsed once at the end.
//
// The lookup is why this is application and not domain -- expansion itself is
// pure and lives in domain/widget.ts. This function only supplies it a registry.

import type { Json } from "../domain/json.ts";
import { isJsonObject } from "../domain/json.ts";
import type { PrimitiveBlock } from "../domain/primitives.ts";
import { parseBlocks } from "../domain/parse.ts";
import { expand, validateProps } from "../domain/widget.ts";
import { widgetName } from "../domain/ids.ts";
import type { ParsedAll } from "../domain/result.ts";
import { noAll, okAll } from "../domain/result.ts";
import type { WidgetStore } from "./ports.ts";

export async function resolveBlocks(
  widgets: WidgetStore,
  input: readonly Json[],
): Promise<ParsedAll<PrimitiveBlock[]>> {
  const errors: string[] = [];
  const flattened: Json[] = [];

  for (const [index, node] of input.entries()) {
    const at = `blocks[${index}]`;
    if (!isJsonObject(node)) {
      errors.push(`${at}: expected an object`);
      continue;
    }

    const reference = node["widget"];
    if (reference === undefined) {
      flattened.push(node);
      continue;
    }
    if (typeof reference !== "string") {
      errors.push(`${at}.widget: expected a widget name`);
      continue;
    }

    const name = widgetName(reference);
    if (!name.ok) {
      errors.push(`${at}.widget: ${name.reason}`);
      continue;
    }

    const def = await widgets.get(name.value);
    if (def === undefined) {
      errors.push(`${at}.widget: no widget named "${reference}" — call list_widgets or define it first`);
      continue;
    }

    const rawProps = node["props"];
    const props = isJsonObject(rawProps) ? rawProps : {};
    if (rawProps !== undefined && !isJsonObject(rawProps)) {
      errors.push(`${at}.props: expected an object`);
      continue;
    }

    const propErrors = validateProps(def, props);
    if (propErrors.length > 0) {
      errors.push(...propErrors.map((e) => `${at}: ${e.reason}`));
      continue;
    }

    flattened.push(...expand(def, props));
  }

  if (errors.length > 0) return noAll(errors);

  const parsed = parseBlocks(flattened);
  if (!parsed.ok) return parsed;
  return okAll(parsed.value);
}
