import { z } from "zod";
import { auditResultSchema, type AuditResult } from "../audit";
import type { LlmConfig, LlmInteraction } from "./config";
import { MERGE_AUDITS_PROMPT, buildMergeContent } from "./prompts";
import { runStructured } from "./structured";

const mergeFindingAttributionSchema = z.object({
  type: z.enum(["risk", "investigationArea", "deepDiveFinding"]),
  index: z.number().int().min(0),
  sources: z.array(z.enum(["A", "B", "judge"])),
});

const mergeExclusionSchema = z.object({
  type: z.enum(["risk", "investigationArea", "deepDiveFinding"]),
  fromModel: z.enum(["A", "B"]),
  titleOrFile: z.string(),
  reason: z.string(),
});

const competitionMergeResultSchema = z.object({
  merged: auditResultSchema,
  attributions: z.array(mergeFindingAttributionSchema).default([]),
  exclusions: z.array(mergeExclusionSchema).default([]),
});

export function applyAttributions(
  merged: AuditResult,
  attributions: z.infer<typeof mergeFindingAttributionSchema>[],
): AuditResult {
  for (const attr of attributions) {
    if (attr.type === "risk" && merged.risks[attr.index]) {
      merged.risks[attr.index].sources = attr.sources;
    } else if (attr.type === "investigationArea" && merged.investigationAreas[attr.index]) {
      merged.investigationAreas[attr.index].sources = attr.sources;
    } else if (attr.type === "deepDiveFinding" && merged.deepDiveFindings[attr.index]) {
      merged.deepDiveFindings[attr.index].sources = attr.sources;
    }
  }
  return merged;
}

export interface CompetitionMergeOutput {
  result: AuditResult;
  exclusions: z.infer<typeof mergeExclusionSchema>[];
  interaction: LlmInteraction;
}

export async function mergeAuditResults(
  resultA: AuditResult,
  resultB: AuditResult,
  mergeConfig: LlmConfig,
  userPrompt?: string,
): Promise<CompetitionMergeOutput> {
  const content = buildMergeContent(resultA, resultB, userPrompt);
  const { parsed, interaction } = await runStructured(
    mergeConfig,
    MERGE_AUDITS_PROMPT,
    content,
    competitionMergeResultSchema,
    "merged_audit_result",
  );
  const merged = applyAttributions(parsed.merged, parsed.attributions);
  return { result: merged, exclusions: parsed.exclusions, interaction };
}
