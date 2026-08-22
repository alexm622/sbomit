import { z } from "zod";
import {
  buildAuditPrompt,
  type InvestigationArea,
  type LibraryContext,
} from "../audit";
import {
  buildBudgetedSnapshot,
  buildLiteSnapshot,
  estimateTokens,
  formatSnapshotForLlm,
  sourceTokenBudget,
  type CodebaseSnapshot,
} from "../codebase";
import type { AuditResult } from "../audit";

function coerceStringToArray<T>(
  value: unknown,
  parser: (item: unknown) => T | undefined,
): T[] | undefined {
  if (Array.isArray(value)) {
    return value.map(parser).filter((item): item is T => item !== undefined);
  }
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) {
        return parsed
          .map(parser)
          .filter((item): item is T => item !== undefined);
      }
    } catch {
      // Fall through to default.
    }
  }
  return undefined;
}

const investigationAreaItemSchema = z.object({
  area: z.string().default(""),
  rationale: z.string().default(""),
  files: z.array(z.string()).default([]),
});

export const investigationSchema = z.object({
  investigationAreas: z.preprocess(
    (value) =>
      coerceStringToArray(value, (item) => {
        const result = investigationAreaItemSchema.safeParse(item);
        return result.success ? result.data : undefined;
      }) ?? [],
    z.array(investigationAreaItemSchema),
  ),
});

export const INVESTIGATION_PROMPT = `You are a software supply-chain auditor reviewing a library's source code.

Your first task is to identify the most important areas to investigate for security, supply-chain, and dependency risks. You are shown either the full codebase snapshot or a "lite" snapshot containing manifest/lifecycle files, a sample of small source files, and a complete file listing. Look at the metadata and the provided snapshot. Focus on:
- install / postinstall / lifecycle scripts
- network calls, dynamic requires, eval, child_process
- obfuscated or minified code bundled in source
- dependency pinning and lockfile hygiene
- sensitive file access, environment variable reads
- unexpected top-level side effects

Return 3-10 investigation areas as a JSON array assigned to the key "investigationAreas". Each area must be an object with exactly these keys:
- area: short name (string)
- rationale: why it matters (string)
- files: specific file paths from the snapshot to examine in detail (array of strings)

Example shape:
{
  "investigationAreas": [
    {
      "area": "Lifecycle scripts",
      "rationale": "postinstall scripts can run arbitrary code during install",
      "files": ["package.json", "scripts/install.js"]
    }
  ]
}

If you are looking at a lite snapshot, prefer selecting files that were not already shown in full so the deep-dive pass can read fresh source code.`;

export const DEEP_DIVE_PROMPT = `You are a software supply-chain auditor performing a deep code review.

You previously identified key investigation areas. Now examine the FULL CONTENTS of the files listed for those areas and produce a complete, structured audit report.

Be specific: cite file paths and line snippets as evidence. If a concern turns out to be benign after inspection, note that and lower the severity. If you find concrete issues, explain the exploit path or maintenance risk.

Return ALL fields defined in the response schema. If a list has no items, return it as an empty array []. If the summary would be empty, write a brief one-sentence summary instead. Do not omit any field.

For the score field, use this rubric as a guide: start from 100, subtract roughly 20-25 for each critical issue, 10-15 for each high issue, 5-8 for each medium issue, and 2-3 for each low issue; subtract 10 for an incompatible license, and prefer the 70-95 range for well-maintained packages with only minor concerns. The final score shown to the user will be computed from your findings, so be consistent and proportional.`;

export const METADATA_ONLY_PROMPT = `You are a software supply-chain auditor reviewing library metadata. The full source code was not available, so base your assessment on the metadata alone.

Identify areas that would be worth investigating if the source code were available, and produce a structured audit report. Be explicit that findings are inferred from metadata, not confirmed by code inspection.

Return ALL fields defined in the response schema. If a list has no items, return it as an empty array []. If the summary would be empty, write a brief one-sentence summary instead. Do not omit any field.

For the score field, use this rubric as a guide: start from 100, subtract roughly 20-25 for each critical issue, 10-15 for each high issue, 5-8 for each medium issue, and 2-3 for each low issue; subtract 10 for an incompatible license. Since source code was not inspected, reserve the top scores (90-100) for packages with no metadata red flags; the final score shown to the user will be computed from your findings.`;

export const MERGE_AUDITS_PROMPT = `You are a senior software supply-chain auditor reviewing two independent AI audits of the same library.

Your task is to merge them into a single, coherent audit report and document exactly how you merged them. Follow these rules:

- Remove duplicate findings: if both audits report the same risk, deep-dive finding, or investigation area, keep only one representative entry (prefer the one with stronger evidence or higher severity).
- Preserve unique findings from both audits.
- Add your own findings only if both audits missed something important and you can cite specific evidence from the audit data provided.
- Reconcile conflicting assessments: if the audits disagree on severity or interpretation, use your judgment and explain briefly in the summary.
- Produce one unified summary that reflects the combined assessment.
- Compute a single trust score (0-100) that represents the merged conclusion. Be proportional: start from 100 and subtract for each confirmed issue using the same rubric as the original audits.
- Keep the same structured output format. Use the library metadata (name, version, etc.) from Audit A unless Audit B clearly has more accurate data.

ATTRIBUTION: For every item in the merged report, record which model(s) originated it in the "attributions" array. Use source "A" for Audit A, "B" for Audit B, and "judge" only for findings you add that neither audit contained. The index must correspond to the position of the item in the merged report array (0-based).

EXCLUSIONS: For every finding you remove as a duplicate, low-quality, or unsupported, record it in the "exclusions" array. Include the type of item, which model it came from (A or B), a short identifying title or file, and a brief reason for exclusion.

Both audits reviewed the same library and version, so the merged report must have the same name and version.`;

function buildMetadataSection(
  context: LibraryContext,
  userPrompt?: string,
): string {
  return buildAuditPrompt(context, userPrompt);
}

function selectSnapshotForInvestigation(
  context: LibraryContext,
): CodebaseSnapshot {
  if (!context.codebase) {
    return { files: [], fileCount: 0, totalSize: 0 };
  }

  const fullText = formatSnapshotForLlm(context.codebase);
  const budget = sourceTokenBudget();

  if (estimateTokens(fullText) <= budget) {
    return context.codebase;
  }

  const lite = buildLiteSnapshot(context.codebase);
  const liteText = formatSnapshotForLlm(lite);
  if (estimateTokens(liteText) <= budget) {
    return lite;
  }

  // Even the lite snapshot is too large; trim it to fit.
  return buildBudgetedSnapshot(lite, budget);
}

export function buildInvestigationContent(
  context: LibraryContext,
  userPrompt?: string,
): string {
  const metadata = buildMetadataSection(context, userPrompt);
  const snapshot = selectSnapshotForInvestigation(context);
  const codebase = formatSnapshotForLlm(snapshot);
  return `${metadata}\n\n${INVESTIGATION_PROMPT}\n\n${codebase}`;
}

function selectFilesForDeepDive(
  context: LibraryContext,
  areas: InvestigationArea[],
): CodebaseSnapshot {
  if (!context.codebase) {
    return { files: [], fileCount: 0, totalSize: 0 };
  }

  const relevantFiles = new Set<string>();
  for (const area of areas) {
    for (const file of area.files) {
      relevantFiles.add(file);
    }
  }

  const budget = sourceTokenBudget();
  // Reserve a portion of the budget for the full snapshot if it fits, so the
  // LLM can still see the whole picture while focusing on selected files.
  const fullText = formatSnapshotForLlm(context.codebase);
  if (estimateTokens(fullText) <= budget) {
    return context.codebase;
  }

  return buildBudgetedSnapshot(context.codebase, budget, relevantFiles);
}

export function buildDeepDiveContent(
  context: LibraryContext,
  areas: InvestigationArea[],
  userPrompt?: string,
): string {
  const metadata = buildMetadataSection(context, userPrompt);

  const areasText = JSON.stringify(
    {
      investigationAreas: areas,
    },
    null,
    2,
  );

  const snapshot = selectFilesForDeepDive(context, areas);
  const filesText =
    snapshot.files.length > 0
      ? `Files selected for deep review:\n\n${formatSnapshotForLlm(snapshot)}`
      : "No source files were available for deep review.";

  return `${metadata}\n\n${DEEP_DIVE_PROMPT}\n\nInvestigation areas:\n${areasText}\n\n${filesText}`;
}

export function buildMetadataOnlyContent(
  context: LibraryContext,
  userPrompt?: string,
): string {
  const metadata = buildMetadataSection(context, userPrompt);
  return `${metadata}\n\n${METADATA_ONLY_PROMPT}`;
}

export function buildMergeContent(
  resultA: AuditResult,
  resultB: AuditResult,
  userPrompt?: string,
): string {
  const metadata = `Library: ${resultA.name}@${resultA.version}`;
  const promptSection = userPrompt
    ? `User focus: ${userPrompt}\n\n`
    : "";
  return `${metadata}\n\n${promptSection}Audit A:\n${JSON.stringify(resultA, null, 2)}\n\nAudit B:\n${JSON.stringify(resultB, null, 2)}\n\n${MERGE_AUDITS_PROMPT}`;
}
