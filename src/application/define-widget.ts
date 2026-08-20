import type { Json } from "../domain/json.ts";
import { isJsonObject } from "../domain/json.ts";
import { widgetName } from "../domain/ids.ts";
import type { PropSpec, PropType, WidgetDef } from "../domain/widget.ts";
import { expand } from "../domain/widget.ts";
import { parseBlocks } from "../domain/parse.ts";
import type { ParsedAll } from "../domain/result.ts";
import { noAll, okAll } from "../domain/result.ts";
import type { Deps } from "./ports.ts";

export type DefineWidgetInput = {
  name: string;
  summary: string;
  props: { name: string; type: string; required?: boolean; description?: string }[];
  layout: Json[];
  // Sample props that make the layout render. Required, because a definition that
  // has never been expanded is a definition nobody has shown to work, and the
  // first agent to use it discovers that mid-task.
  example: Record<string, Json>;
};

const PROP_TYPES: readonly string[] = ["string", "number", "boolean", "array", "object"];

export async function defineWidget(deps: Deps, input: DefineWidgetInput): Promise<ParsedAll<WidgetDef>> {
  const name = widgetName(input.name);
  if (!name.ok) return noAll([`name: ${name.reason}`]);

  const existing = await deps.widgets.get(name.value);
  if (existing?.builtin === true) {
    return noAll([`name: "${input.name}" is a built-in widget and cannot be redefined`]);
  }

  const errors: string[] = [];
  const props: PropSpec[] = [];
  input.props.forEach((p, i) => {
    if (!PROP_TYPES.includes(p.type)) {
      errors.push(`props[${i}].type: expected one of ${PROP_TYPES.join(", ")}`);
      return;
    }
    props.push({
      name: p.name,
      type: p.type as PropType,
      required: p.required ?? false,
      ...(p.description !== undefined ? { description: p.description } : {}),
    });
  });
  if (!Array.isArray(input.layout) || input.layout.length === 0) {
    errors.push("layout: expected a non-empty array of template nodes");
  }
  if (!isJsonObject(input.example)) errors.push("example: expected an object of sample props");
  if (errors.length > 0) return noAll(errors);

  const def: WidgetDef = {
    name: name.value,
    summary: input.summary,
    props,
    layout: input.layout,
    builtin: false,
  };

  // Prove it renders before it is stored. This is the whole reason `example` is
  // required: a widget that only fails when an agent reaches for it mid-task is
  // worse than one that was refused at definition time.
  const rendered = parseBlocks(expand(def, input.example));
  if (!rendered.ok) return noAll(rendered.errors.map((e) => `layout (expanded with example): ${e}`));

  await deps.widgets.define(def);
  return okAll(def);
}
