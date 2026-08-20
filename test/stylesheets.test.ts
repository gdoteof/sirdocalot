// The shared stylesheet is included by every page, and a page that redefines one
// of its class names silently restyles content it does not own.
//
// This has happened twice. The gallery defined `.label`, which is what the block
// renderer calls a field label, so every input inside a preview rendered
// uppercase and tiny -- previews showing something a real brief never looks like.
// The same page defined `.req`, the asterisk on a required label. Both were found
// by eye, which is not a method.
//
// A compound or descendant selector is fine: `.footer a` extends, it does not
// shadow. What is forbidden is redefining the bare class.

import { strictEqual } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const read = (path: string): string => readFileSync(new URL(path, import.meta.url), "utf8");

// Bare single-class rules only: `.foo {`, not `.foo a {` or `.foo.bar {`.
function bareClasses(css: string): Set<string> {
  const found = new Set<string>();
  for (const line of css.split("\n")) {
    const match = /^\s*\.([a-z][a-z0-9-]*)\s*(?:,\s*\.[a-z][a-z0-9-]*\s*)*\{/.exec(line);
    if (match?.[1] !== undefined) found.add(match[1]);
  }
  return found;
}

function embeddedCss(source: string, constName: string): string {
  const match = new RegExp(`${constName} = \`([\\s\\S]*?)\`;`).exec(source);
  return match?.[1] ?? "";
}

describe("page stylesheets do not shadow the shared one", () => {
  const shared = bareClasses(read("../src/adapters/render/style.ts"));

  it("finds the shared classes at all, so an empty set cannot pass vacuously", () => {
    strictEqual(shared.has("prose"), true);
    strictEqual(shared.has("label"), true);
    strictEqual(shared.size > 20, true);
  });

  const pages: [string, string, string][] = [
    ["landing", "../src/adapters/http/landing.ts", "PAGE_STYLE"],
    ["gallery", "../src/adapters/render/gallery.ts", "GALLERY_STYLE"],
  ];

  for (const [name, path, constName] of pages) {
    it(`${name} redefines none of them`, () => {
      const css = embeddedCss(read(path), constName);
      strictEqual(css.length > 0, true);
      const clashes = [...bareClasses(css)].filter((c) => shared.has(c)).sort();
      strictEqual(clashes.join(", "), "");
    });
  }
});
