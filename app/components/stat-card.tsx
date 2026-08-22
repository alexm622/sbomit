import * as React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/app/components/ui/card";

interface StatCardProps {
  icon?: React.ElementType;
  label: string;
  value: React.ReactNode;
  compact?: boolean;
}

export function StatCard({ icon: Icon, label, value, compact }: StatCardProps) {
  if (compact) {
    return (
      <Card>
        <CardContent className="py-4">
          <div className="text-xs text-muted-foreground">{label}</div>
          <div className="text-xl font-semibold">{value}</div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
          {Icon && <Icon className="h-4 w-4" />}
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-3xl font-bold">{value}</div>
      </CardContent>
    </Card>
  );
}
