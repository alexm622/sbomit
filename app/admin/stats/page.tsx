"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Loader2, AlertCircle, BarChart3, FileText, Users, Coins, Activity, Cpu, Building2, Trophy } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/app/components/ui/card";
import { Alert } from "@/app/components/ui/alert";
import { StatCard } from "@/app/components/stat-card";
import { PageShell } from "@/app/components/page-shell";
import { providerLabel } from "@/app/lib/variants";
import { formatDuration } from "@/app/lib/format";
import { apiFetch } from "@/app/lib/api-fetch";
import { useAuth } from "@/app/lib/use-auth";

interface ModelBreakdown {
  model: string;
  tokens: number;
  audits: number;
  avgTokens: number;
}

interface ProviderBreakdown {
  provider: string;
  tokens: number;
  audits: number;
  avgTokens: number;
}

interface TokensOverTime {
  date: string;
  tokens: number;
  audits: number;
}

interface ScoreDistribution {
  range: string;
  audits: number;
}

interface DailyActiveUsers {
  date: string;
  users: number;
}

interface ProviderBudgetUtilization {
  id: string;
  name: string;
  limit: number;
  used: number;
  pct: number;
}

interface TopUser {
  id: number;
  username: string;
  fullName: string;
  auditsRun: number;
  tokensTotal: number;
}

interface OverallStats {
  totalAudits: number;
  totalUsers: number;
  totalTokens: number;
  tokensToday: number;
  auditsToday: number;
  avgTokensPerAudit: number;
  estimatedSpend: number;
  cacheHitRate: number;
  avgAuditDurationMs: number;
  tokensOverTime: TokensOverTime[];
  tokensByModel: ModelBreakdown[];
  tokensByProvider: ProviderBreakdown[];
  scoreDistribution: ScoreDistribution[];
  dailyActiveUsers: DailyActiveUsers[];
  providerBudgetUtilization: ProviderBudgetUtilization[];
  topUsers: TopUser[];
}

function Histogram({ data }: { data: ScoreDistribution[] }) {
  if (data.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">No score data available.</p>
    );
  }
  const max = Math.max(...data.map((d) => d.audits), 1);
  return (
    <div className="space-y-3">
      {data.map((row) => {
        const pct = Math.round((row.audits / max) * 100);
        return (
          <div key={row.range} className="space-y-1">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium">{row.range}</span>
              <span className="text-muted-foreground">
                {row.audits} audit{row.audits === 1 ? "" : "s"}
              </span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-emerald-500 transition-all"
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function BarRow({
  label,
  value,
  max,
  subtext,
}: {
  label: string;
  value: number;
  max: number;
  subtext: string;
}) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-sm">
        <span className="truncate font-medium">{label}</span>
        <span className="ml-4 whitespace-nowrap text-muted-foreground">
          {subtext}
        </span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-primary transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

interface LineChartPoint {
  date: string;
  value: number;
  count: number;
}

function LineChart({
  data,
  valueLabel = "tokens",
  countLabel = "audits",
}: {
  data: LineChartPoint[];
  valueLabel?: string;
  countLabel?: string;
}) {
  const [hoverIndex, setHoverIndex] = React.useState<number | null>(null);

  if (data.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">No time-series data available.</p>
    );
  }

  const width = 800;
  const height = 240;
  const padding = { top: 16, right: 16, bottom: 40, left: 56 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;

  const maxValue = Math.max(...data.map((d) => d.value), 1);
  const xForIndex = (i: number) =>
    padding.left + (i / Math.max(data.length - 1, 1)) * chartWidth;
  const yForValue = (value: number) =>
    padding.top + chartHeight - (value / maxValue) * chartHeight;

  const linePath = data
    .map((d, i) => `${i === 0 ? "M" : "L"} ${xForIndex(i)} ${yForValue(d.value)}`)
    .join(" ");

  const areaPath =
    linePath +
    ` L ${xForIndex(data.length - 1)} ${padding.top + chartHeight} L ${padding.left} ${padding.top + chartHeight} Z`;

  const yTicks = 5;
  const formatDate = (date: string) => {
    const d = new Date(`${date}T00:00:00`);
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  };

  return (
    <div className="w-full overflow-x-auto">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full min-w-[600px]"
        onMouseLeave={() => setHoverIndex(null)}
      >
        {/* Grid lines */}
        {Array.from({ length: yTicks + 1 }).map((_, i) => {
          const y = padding.top + (i / yTicks) * chartHeight;
          return (
            <line
              key={i}
              x1={padding.left}
              y1={y}
              x2={padding.left + chartWidth}
              y2={y}
              className="stroke-muted"
              strokeDasharray="4 4"
            />
          );
        })}

        {/* Y-axis labels */}
        {Array.from({ length: yTicks + 1 }).map((_, i) => {
          const value = Math.round(maxValue - (i / yTicks) * maxValue);
          const y = padding.top + (i / yTicks) * chartHeight;
          return (
            <text
              key={i}
              x={padding.left - 8}
              y={y + 4}
              textAnchor="end"
              className="fill-muted-foreground text-xs"
            >
              {value.toLocaleString()}
            </text>
          );
        })}

        {/* X-axis labels */}
        {data.map((d, i) => {
          if (data.length <= 7 || i % Math.ceil(data.length / 6) === 0 || i === data.length - 1) {
            return (
              <text
                key={i}
                x={xForIndex(i)}
                y={height - 12}
                textAnchor="middle"
                className="fill-muted-foreground text-xs"
              >
                {formatDate(d.date)}
              </text>
            );
          }
          return null;
        })}

        {/* Area under the line */}
        <path d={areaPath} className="fill-primary/10" />

        {/* Line */}
        <path
          d={linePath}
          className="fill-none stroke-primary stroke-2"
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {/* Data points */}
        {data.map((d, i) => (
          <circle
            key={i}
            cx={xForIndex(i)}
            cy={yForValue(d.value)}
            r={hoverIndex === i ? 5 : 3}
            className="fill-primary stroke-background stroke-2"
            onMouseEnter={() => setHoverIndex(i)}
          />
        ))}

        {/* Hover tooltip line and label */}
        {hoverIndex !== null && (
          <g>
            <line
              x1={xForIndex(hoverIndex)}
              y1={padding.top}
              x2={xForIndex(hoverIndex)}
              y2={padding.top + chartHeight}
              className="stroke-muted-foreground"
              strokeDasharray="4 4"
            />
            <g
              transform={`translate(${xForIndex(hoverIndex) + 8}, ${yForValue(data[hoverIndex].value) - 8})`}
            >
              <rect
                x={0}
                y={-20}
                width={160}
                height={40}
                rx={6}
                className="fill-background stroke-border stroke-1"
              />
              <text
                x={8}
                y={-4}
                className="fill-foreground text-xs font-medium"
              >
                {formatDate(data[hoverIndex].date)}
              </text>
              <text
                x={8}
                y={12}
                className="fill-muted-foreground text-xs"
              >
                {data[hoverIndex].value.toLocaleString()} {valueLabel} ·{" "}
                {data[hoverIndex].count} {countLabel}
                {data[hoverIndex].count === 1 ? "" : "s"}
              </text>
            </g>
          </g>
        )}
      </svg>
    </div>
  );
}

export default function AdminStatsPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const [stats, setStats] = React.useState<OverallStats | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    setError(null);
    try {
      const data = await apiFetch<{ stats?: OverallStats }>("/api/admin/stats");
      setStats(data.stats ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load stats.");
    }
  }, []);

  React.useEffect(() => {
    if (authLoading) return;
    if (!user || !user.isAdmin) {
      router.replace("/");
      return;
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [user, authLoading, router, load]);

  if (authLoading || !user?.isAdmin) {
    return (
      <PageShell mainClassName="flex items-center justify-center" footer={false}>
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </PageShell>
    );
  }

  return (
    <PageShell maxWidth="4xl" backHref="/" footer={false}>
      <div className="flex items-center gap-3"><BarChart3 className="h-6 w-6 text-primary" /><h1 className="text-3xl font-bold tracking-tight">Overall stats</h1></div>
      <p className="mt-2 text-muted-foreground">System-wide usage and activity.</p>

      {error && (
        <Alert variant="error" className="mt-6 gap-2 rounded-lg px-3 py-2 text-sm">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          {error}
        </Alert>
      )}

      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard icon={FileText} label="Total audits" value={stats?.totalAudits ?? 0} />
        <StatCard icon={Users} label="Total users" value={stats?.totalUsers ?? 0} />
        <StatCard icon={Coins} label="Total tokens" value={(stats?.totalTokens ?? 0).toLocaleString()} />
        <StatCard icon={Activity} label="Audits today" value={stats?.auditsToday ?? 0} />
        <StatCard icon={Coins} label="Tokens today" value={(stats?.tokensToday ?? 0).toLocaleString()} />
        <StatCard icon={BarChart3} label="Avg tokens / audit" value={(stats?.avgTokensPerAudit ?? 0).toLocaleString()} />
        <StatCard icon={Coins} label="Est. spend" value={`$${(stats?.estimatedSpend ?? 0).toFixed(2)}`} />
        <StatCard icon={Activity} label="Cache hit rate" value={`${stats?.cacheHitRate ?? 0}%`} />
        <StatCard icon={BarChart3} label="Avg audit time" value={formatDuration(stats?.avgAuditDurationMs ?? 0)} />
      </div>

          <div className="mt-10">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base font-semibold">
                  <BarChart3 className="h-5 w-5 text-primary" />
                  Tokens over time (last 30 days)
                </CardTitle>
              </CardHeader>
              <CardContent>
                {stats && stats.tokensOverTime.length > 0 ? (
                  <LineChart
                    data={stats.tokensOverTime.map((d) => ({
                      date: d.date,
                      value: d.tokens,
                      count: d.audits,
                    }))}
                  />
                ) : (
                  <p className="text-sm text-muted-foreground">No activity in the last 30 days.</p>
                )}
              </CardContent>
            </Card>
          </div>

          <div className="mt-10 grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base font-semibold">
                  <BarChart3 className="h-5 w-5 text-primary" />
                  Score distribution
                </CardTitle>
              </CardHeader>
              <CardContent>
                {stats && stats.scoreDistribution.length > 0 ? (
                  <Histogram data={stats.scoreDistribution} />
                ) : (
                  <p className="text-sm text-muted-foreground">No score data available.</p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base font-semibold">
                  <Users className="h-5 w-5 text-primary" />
                  Daily active users (last 30 days)
                </CardTitle>
              </CardHeader>
              <CardContent>
                {stats && stats.dailyActiveUsers.length > 0 ? (
                  <LineChart
                    data={stats.dailyActiveUsers.map((d) => ({
                      date: d.date,
                      value: d.users,
                      count: d.users,
                    }))}
                    valueLabel="users"
                    countLabel="user"
                  />
                ) : (
                  <p className="text-sm text-muted-foreground">No user activity in the last 30 days.</p>
                )}
              </CardContent>
            </Card>
          </div>

          <div className="mt-10 grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base font-semibold">
                  <Cpu className="h-5 w-5 text-primary" />
                  Tokens by model
                </CardTitle>
              </CardHeader>
              <CardContent>
                {stats && stats.tokensByModel.length > 0 ? (
                  <div className="space-y-4">
                    {(() => {
                      const maxTokens = Math.max(
                        ...stats.tokensByModel.map((r) => r.tokens),
                      );
                      return stats.tokensByModel.map((row) => (
                        <BarRow
                          key={row.model}
                          label={row.model}
                          value={row.tokens}
                          max={maxTokens}
                          subtext={`${row.tokens.toLocaleString()} tokens · ${row.audits} audit${row.audits === 1 ? "" : "s"} · avg ${row.avgTokens.toLocaleString()}`}
                        />
                      ));
                    })()}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">No model data available.</p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base font-semibold">
                  <Building2 className="h-5 w-5 text-primary" />
                  Tokens by provider
                </CardTitle>
              </CardHeader>
              <CardContent>
                {stats && stats.tokensByProvider.length > 0 ? (
                  <div className="space-y-4">
                    {(() => {
                      const maxTokens = Math.max(
                        ...stats.tokensByProvider.map((r) => r.tokens),
                      );
                      return stats.tokensByProvider.map((row) => (
                        <BarRow
                          key={row.provider}
                          label={providerLabel(row.provider)}
                          value={row.tokens}
                          max={maxTokens}
                          subtext={`${row.tokens.toLocaleString()} tokens · ${row.audits} audit${row.audits === 1 ? "" : "s"} · avg ${row.avgTokens.toLocaleString()}`}
                        />
                      ));
                    })()}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">No provider data available.</p>
                )}
              </CardContent>
            </Card>
          </div>

          {stats && stats.providerBudgetUtilization.length > 0 && (
            <div className="mt-10">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base font-semibold">
                    <Coins className="h-5 w-5 text-primary" />
                    Provider daily budget utilization
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    {stats.providerBudgetUtilization.map((row) => (
                      <div key={row.id} className="space-y-1">
                        <div className="flex items-center justify-between text-sm">
                          <span className="font-medium">{row.name}</span>
                          <span className="text-muted-foreground">
                            {row.used.toLocaleString()} / {row.limit.toLocaleString()} tokens ({row.pct}%)
                          </span>
                        </div>
                        <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                          <div
                            className={`h-full rounded-full transition-all ${
                              row.pct >= 100
                                ? "bg-red-500"
                                : row.pct >= 80
                                  ? "bg-amber-500"
                                  : "bg-emerald-500"
                            }`}
                            style={{ width: `${Math.min(row.pct, 100)}%` }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          <div className="mt-10">
            <h2 className="mb-4 flex items-center gap-2 text-xl font-semibold">
              <Trophy className="h-5 w-5 text-primary" />
              Most active users
            </h2>
            {stats && stats.topUsers.length > 0 ? (
              <div className="space-y-3">
                {stats.topUsers.map((user, index) => (
                  <Card key={user.id}>
                    <CardContent className="flex items-center justify-between py-4">
                      <div className="flex items-center gap-4">
                        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-sm font-semibold">
                          {index + 1}
                        </div>
                        <div>
                          <div className="font-medium">{user.fullName || user.username}</div>
                          <div className="text-xs text-muted-foreground">@{user.username} · {user.auditsRun} audit{user.auditsRun === 1 ? "" : "s"}</div>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="font-semibold">{user.tokensTotal.toLocaleString()}</div>
                        <div className="text-xs text-muted-foreground">tokens</div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : (
              <Card>
                <CardContent className="py-8 text-center text-sm text-muted-foreground">
                  No user activity yet.
                </CardContent>
              </Card>
            )}
          </div>
    </PageShell>
  );
}
