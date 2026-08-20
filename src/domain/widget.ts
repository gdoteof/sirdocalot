// The registry: how a name plus props becomes primitive blocks.
//
// A widget is a props declaration and a layout template. Both are data, but data
// that ships with the service and changes by pull request -- an agent cannot add
// one, and the shared vocabulary is therefore reviewed rather than accumulated.
//
// The template language is deliberately three constructs. It is a layout binder,
// not a programming language, and every construct it grows is one an agent has to
// learn before it can emit anything.

import type { Json } from "./json.ts";
import { isJsonObject, resolvePath } from "./json.ts";
import type { WidgetName } from "./ids.ts";

export type PropType = "string" | "number" | "boolean" | "array" | "object";

export type PropSpec = {
  name: string;
  type: PropType;
  required: boolean;
  description?: string;
};

export type WidgetDef = {
  name: WidgetName;
  summary: string;
  props: PropSpec[];
  // A list of template nodes, each expanding to zero or more primitive blocks.
  layout: Json[];
};

export type ExpandError = { widget: string; reason: string };

export function validateProps(def: WidgetDef, props: Readonly<Record<string, Json>>): ExpandError[] {
  const errors: ExpandError[] = [];
  for (const spec of def.props) {
    const value = props[spec.name];
    if (value === undefined || value === null) {
      if (spec.required) errors.push({ widget: def.name, reason: `missing required prop "${spec.name}"` });
      continue;
    }
    if (!matchesType(value, spec.type)) {
      errors.push({ widget: def.name, reason: `prop "${spec.name}" should be ${spec.type}` });
    }
  }
  const declared = new Set(def.props.map((p) => p.name));
  for (const key of Object.keys(props)) {
    // Same reasoning as a stray answer: an undeclared prop means the caller had a
    // different definition in mind than the one stored, and silently ignoring it
    // renders a brief that is missing what the agent thought it had said.
    if (!declared.has(key)) errors.push({ widget: def.name, reason: `unknown prop "${key}"` });
  }
  return errors;
}

function matchesType(value: Json, type: PropType): boolean {
  switch (type) {
    case "string":
      return typeof value === "string";
    case "number":
      return typeof value === "number";
    case "boolean":
      return typeof value === "boolean";
    case "array":
      return Array.isArray(value);
    case "object":
      return isJsonObject(value);
  }
}

// Expansion is pure and total: it either produces plain JSON blocks or it does
// not, and it never partially renders. Whether those blocks are *valid primitive
// blocks* is a separate parse -- see parse.ts -- because that check must also run
// on blocks an agent supplied directly, without any widget involved.
export function expand(def: WidgetDef, props: Readonly<Record<string, Json>>): Json[] {
  return expandList(def.layout, { ...props });
}

type Scope = Record<string, Json>;

function expandList(nodes: readonly Json[], scope: Scope): Json[] {
  const out: Json[] = [];
  for (const node of nodes) {
    if (isJsonObject(node) && typeof node["$each"] === "string") {
      const source = resolvePath(scope, node["$each"]);
      const alias = typeof node["as"] === "string" ? node["as"] : "item";
      const body = Array.isArray(node["body"]) ? node["body"] : [];
      if (!Array.isArray(source)) continue;
      source.forEach((item, index) => {
        out.push(...expandList(body, { ...scope, [alias]: item, [`${alias}_index`]: index }));
      });
      continue;
    }
    if (isJsonObject(node) && typeof node["$if"] === "string") {
      const test = resolvePath(scope, node["$if"]);
      const branch = truthy(test) ? node["then"] : node["else"];
      if (Array.isArray(branch)) out.push(...expandList(branch, scope));
      continue;
    }
    out.push(expandValue(node, scope));
  }
  return out;
}

function expandValue(node: Json, scope: Scope): Json {
  if (Array.isArray(node)) return expandList(node, scope);
  if (!isJsonObject(node)) return node;

  // A lone {"$": "path"} substitutes the value at that path, whatever its type.
  // Substituting a whole array or object is the point: a table's rows arrive as
  // one binding rather than a loop the template would otherwise have to run.
  const ref = node["$"];
  if (typeof ref === "string" && Object.keys(node).length === 1) {
    const resolved = resolvePath(scope, ref);
    return resolved === undefined ? null : resolved;
  }

  const out: { [key: string]: Json } = {};
  for (const [key, value] of Object.entries(node)) out[key] = expandValue(value, scope);
  return out;
}

function truthy(v: Json | undefined): boolean {
  if (v === undefined || v === null || v === false) return false;
  if (Array.isArray(v)) return v.length > 0;
  if (v === "" || v === 0) return false;
  return true;
}
