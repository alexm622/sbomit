export function formatTimestamp(
  iso: string | number | Date | null | undefined,
): string {
  if (iso == null) return "";
  let date: Date;
  if (iso instanceof Date) {
    date = iso;
  } else if (typeof iso === "number") {
    date = new Date(iso);
  } else {
    // SQLite CURRENT_TIMESTAMP is UTC ("YYYY-MM-DD HH:MM:SS").
    const normalized = `${iso.replace(" ", "T")}Z`;
    date = new Date(normalized);
  }
  if (Number.isNaN(date.getTime())) return String(iso);
  return date.toLocaleString();
}

export function formatDuration(ms: number): string {
  if (!ms || ms <= 0) return "—";
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes < 60) return `${minutes}m ${remainingSeconds}s`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${remainingMinutes}m`;
}

export function aggregateTokens(
  interactions:
    | { tokensInput?: number | null; tokensOutput?: number | null }[]
    | null
    | undefined,
): number {
  if (!interactions) return 0;
  let total = 0;
  for (const interaction of interactions) {
    if (interaction.tokensInput != null) {
      total += interaction.tokensInput;
    }
    if (interaction.tokensOutput != null) {
      total += interaction.tokensOutput;
    }
  }
  return total;
}
