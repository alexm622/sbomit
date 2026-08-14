import OpenAI from "openai";
import { zodResponseFormat } from "openai/helpers/zod";
import {
  auditResultSchema,
  type AuditResult,
  type EnrichedContext,
} from "./audit";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const DEFAULT_PROMPT = `Audit this library for security, license compatibility, and dependency risks. Return a concise, structured report. The response must be valid JSON matching the requested schema.`;

export async function runLibraryAudit(
  enriched: EnrichedContext,
  userPrompt?: string,
): Promise<AuditResult> {
  const prompt = userPrompt?.trim() || DEFAULT_PROMPT;

  const completion = await openai.chat.completions.parse({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content:
          "You are a software supply-chain auditor. Analyze library metadata and produce a structured audit report. Be factual and conservative. If data is missing, infer reasonably or mark uncertainty with lower severity.",
      },
      {
        role: "user",
        content: `${prompt}\n\nLibrary URL: ${enriched.context.url}\nSource: ${enriched.context.source}\nName: ${enriched.context.name}\nVersion: ${enriched.context.version}\n\nMetadata:\n\`\`\`json\n${JSON.stringify(enriched.context.metadata, null, 2)}\n\`\`\`\n\nKnown Vulnerabilities (OSV):\n\`\`\`json\n${JSON.stringify(enriched.vulnerabilities, null, 2)}\n\`\`\`${enriched.githubSignals ? `\n\nGitHub Signals:\n\`\`\`json\n${JSON.stringify(enriched.githubSignals, null, 2)}\n\`\`\`` : ""}`,
      },
    ],
    response_format: zodResponseFormat(auditResultSchema, "audit_result"),
  });

  const parsed = completion.choices[0]?.message?.parsed;
  if (!parsed) {
    throw new Error("OpenAI did not return a structured audit result.");
  }

  return parsed;
}
