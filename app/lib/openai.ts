import OpenAI from "openai";
import { zodResponseFormat } from "openai/helpers/zod";
import {
  auditResultSchema,
  type AuditResult,
  type LibraryContext,
} from "./audit";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const DEFAULT_PROMPT = `Audit this library for security, license compatibility, and dependency risks. Return a concise, structured report. The response must be valid JSON matching the requested schema.`;

export async function runLibraryAudit(
  context: LibraryContext,
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
        content: `${prompt}\n\nLibrary URL: ${context.url}\nSource: ${context.source}\nName: ${context.name}\nVersion: ${context.version}\n\nMetadata:\n\`\`\`json\n${JSON.stringify(context.metadata, null, 2)}\n\`\`\``,
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
