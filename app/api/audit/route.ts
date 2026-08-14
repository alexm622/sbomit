import { resolveLibrary } from "@/app/lib/audit";
import { runLibraryAudit } from "@/app/lib/openai";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      libraryUrl?: string;
      prompt?: string;
    };
    const libraryUrl = body.libraryUrl?.trim();

    if (!libraryUrl) {
      return Response.json(
        { error: "libraryUrl is required." },
        { status: 400 },
      );
    }

    const context = await resolveLibrary(libraryUrl);
    const result = await runLibraryAudit(context, body.prompt);

    return Response.json({ result });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "An unexpected error occurred.";
    return Response.json({ error: message }, { status: 500 });
  }
}
