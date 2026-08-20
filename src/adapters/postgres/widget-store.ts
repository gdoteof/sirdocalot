import type { WidgetName } from "../../domain/ids.ts";
import type { Json } from "../../domain/json.ts";
import type { PropSpec, WidgetDef } from "../../domain/widget.ts";
import { BUILTIN_WIDGETS } from "../../domain/builtin-widgets.ts";
import type { WidgetStore } from "../../application/ports.ts";
import type { Db } from "./pool.ts";

type WidgetRow = { name: string; summary: string; props: PropSpec[]; layout: Json[]; builtin: boolean };

const toDef = (row: WidgetRow): WidgetDef => ({
  name: row.name as WidgetName,
  summary: row.summary,
  props: row.props,
  layout: row.layout,
  builtin: row.builtin,
});

export function widgetStore(db: Db): WidgetStore {
  return {
    async get(name: WidgetName): Promise<WidgetDef | undefined> {
      const { rows } = await db.query<WidgetRow>("select * from widgets where name = $1", [name]);
      const row = rows[0];
      return row === undefined ? undefined : toDef(row);
    },

    async list(): Promise<WidgetDef[]> {
      const { rows } = await db.query<WidgetRow>("select * from widgets order by builtin desc, name asc");
      return rows.map(toDef);
    },

    async define(def: WidgetDef): Promise<void> {
      await db.query(
        `insert into widgets (name, summary, props, layout, builtin, updated_at)
         values ($1, $2, $3, $4, $5, now())
         on conflict (name) do update
           set summary = excluded.summary,
               props = excluded.props,
               layout = excluded.layout,
               updated_at = now()`,
        [def.name, def.summary, JSON.stringify(def.props), JSON.stringify(def.layout), def.builtin],
      );
    },
  };
}

// Builtins are upserted on every start, so a change to the shipped set lands with
// the deploy that ships it. `builtin` is never flipped on an existing row: a name
// an agent has already defined stays theirs, and the collision is reported by
// defineWidget rather than resolved silently here.
export async function seedBuiltins(store: WidgetStore): Promise<number> {
  for (const def of BUILTIN_WIDGETS) await store.define(def);
  return BUILTIN_WIDGETS.length;
}
