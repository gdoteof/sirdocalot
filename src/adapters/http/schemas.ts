// The envelope, parsed at the boundary. Only the envelope: block and widget
// contents are parsed by the domain, which owns what a valid block is, and a zod
// mirror of that here would be the second definition that drifts.

import { z } from "zod";

export const closeWhenSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("all") }),
  z.object({ kind: z.literal("quorum"), n: z.number().int().min(1) }),
  z.object({ kind: z.literal("deadline"), at: z.iso.datetime() }),
  z.object({ kind: z.literal("manual") }),
]);

export const policySchema = z.object({
  closeWhen: closeWhenSchema.default({ kind: "all" }),
  visibility: z.enum(["blind", "open"]).default("blind"),
});

export const createBriefSchema = z.object({
  title: z.string().min(1),
  blocks: z.array(z.unknown()).min(1),
  participants: z
    .array(z.object({ id: z.string().optional(), name: z.string().min(1), role: z.string().optional() }))
    .default([]),
  policy: policySchema.default({ closeWhen: { kind: "all" }, visibility: "blind" }),
  intent: z.object({ purpose: z.string().min(1), resumeHint: z.string().optional() }),
});

export const defineWidgetSchema = z.object({
  name: z.string().min(1),
  summary: z.string().min(1),
  props: z
    .array(
      z.object({
        name: z.string().min(1),
        type: z.string(),
        required: z.boolean().optional(),
        description: z.string().optional(),
      }),
    )
    .default([]),
  layout: z.array(z.unknown()).min(1),
  example: z.record(z.string(), z.unknown()).default({}),
});

export type CreateBriefBody = z.infer<typeof createBriefSchema>;
export type DefineWidgetBody = z.infer<typeof defineWidgetSchema>;
