import { providerLabels, type Provider } from "./providers";

export function providerLabel(providerId: string | null | undefined): string {
  if (!providerId) return "Unknown";
  return providerLabels[providerId as Provider] ?? providerId;
}

export function severityVariant(
  severity: string,
):
  | "default"
  | "secondary"
  | "destructive"
  | "outline"
  | "success"
  | "warning" {
  switch (severity) {
    case "critical":
    case "high":
      return "destructive";
    case "medium":
      return "warning";
    case "low":
      return "secondary";
    default:
      return "default";
  }
}

export function scoreBadgeVariant(
  score: number,
):
  | "default"
  | "secondary"
  | "destructive"
  | "outline"
  | "success"
  | "warning" {
  if (score >= 80) return "success";
  if (score >= 60) return "warning";
  return "destructive";
}

export const scoreVariant = scoreBadgeVariant;

export function scoreProgressVariant(
  score: number,
): "default" | "success" | "warning" | "danger" {
  if (score >= 80) return "success";
  if (score >= 60) return "warning";
  return "danger";
}
