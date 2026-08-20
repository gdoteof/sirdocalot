// The layering rule from CLAUDE.md, checked rather than asserted.
//
// WHY REACHABILITY AND NOT IMPORTS. A per-file import check passes on a helper
// inside the domain that imports node:fs, because the helper is not a decider and
// the decider that calls it is clean by the same check -- while the invariant is
// broken anyway. `reachable` asks whether a path exists through the module graph,
// which is the shape the rule is actually stated in.
//
// Every rule here names a directory that exists. A forbidden rule naming a
// directory the tree has not got is inert: it can never fire, so it has never
// been shown to fire, and it makes this file claim a structure the tree lacks.

const adapterDirs = ["http", "postgres", "render", "crypto", "notify"];

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "domain-is-pure",
      comment:
        "src/domain/ reaches nothing outside itself, transitively, by any path. " +
        'Stated as "reaches nothing else" rather than as a list of banned modules: ' +
        "it is the stronger claim and the simpler one, it subsumes the " +
        "zero-dependency target, and it needs no list of platform modules kept " +
        "current. The domain has no clock, no randomness, no I/O and no packages.",
      severity: "error",
      from: { path: "^src/domain/" },
      to: { reachable: true, path: "^(?!src/domain/)" },
    },
    {
      name: "application-holds-no-adapter",
      comment:
        "src/application/ orchestrates and decides nothing, so it names no " +
        "implementation. It declares ports; something outside implements them. " +
        "A use case that reached an adapter would be one the tests cannot run " +
        "without the real world supplying an answer.",
      severity: "error",
      from: { path: "^src/application/" },
      to: { reachable: true, path: "^src/(adapters|main\\.ts|config\\.ts)" },
    },
    ...adapterDirs.map((dir) => ({
      name: `adapter-${dir}-is-alone`,
      comment:
        `src/adapters/${dir}/ never reaches another adapter. Two adapters that ` +
        "need each other are either one adapter, or the coordination between " +
        "them belongs above both -- in the composition root, which is the only " +
        "module allowed to know every implementation exists.",
      severity: "error",
      from: { path: `^src/adapters/${dir}/` },
      to: {
        reachable: true,
        path: `^src/adapters/(?!${dir}/)`,
        pathNot: "^src/adapters/clock\\.ts$",
      },
    })),
    {
      name: "nothing-imports-the-root",
      comment:
        "src/main.ts is the composition root: it is imported by nothing, which " +
        "is what makes it safe for it to import everything.",
      severity: "error",
      from: { pathNot: "^src/main\\.ts$" },
      to: { path: "^src/main\\.ts$" },
    },
    {
      name: "no-circular",
      comment: "A cycle is a boundary that was drawn and then crossed back over.",
      severity: "error",
      from: {},
      to: { circular: true },
    },
    {
      name: "no-orphans",
      comment: "A module nothing reaches is either dead or a boundary nobody wired up.",
      severity: "warn",
      from: { orphan: true, pathNot: "^src/main\\.ts$" },
      to: {},
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    tsConfig: { fileName: "tsconfig.json" },
    tsPreCompilationDeps: true,
    enhancedResolveOptions: { extensions: [".ts", ".js"] },
    reporterOptions: { text: { highlightFocused: true } },
  },
};
