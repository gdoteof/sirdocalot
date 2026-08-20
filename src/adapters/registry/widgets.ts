// The widget registry, which is now simply the shipped set.
//
// Widgets used to be rows an agent could POST to, so the library could grow
// without a deploy. That is gone: a widget is a reviewed change to
// domain/builtin-widgets.ts and nothing else, so the table it lived in was a
// cache of a constant and the seeding on every boot was work to keep a copy
// agreeing with its original.
//
// What this costs is the mid-task escape hatch, and that cost is accepted. An
// agent that needs a shape none of these cover has the sandboxed `raw` block,
// and if it needs it twice that is the argument for a pull request.

import { BUILTIN_WIDGETS } from "../../domain/builtin-widgets.ts";
import type { WidgetName } from "../../domain/ids.ts";
import type { WidgetDef } from "../../domain/widget.ts";
import type { WidgetStore } from "../../application/ports.ts";

export function builtinWidgets(): WidgetStore {
  const byName = new Map<string, WidgetDef>(BUILTIN_WIDGETS.map((w) => [w.name, w]));
  return {
    async get(name: WidgetName): Promise<WidgetDef | undefined> {
      return byName.get(name);
    },
    async list(): Promise<WidgetDef[]> {
      return [...BUILTIN_WIDGETS];
    },
  };
}
