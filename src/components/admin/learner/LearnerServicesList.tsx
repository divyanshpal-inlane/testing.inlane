import { useQuery } from "@tanstack/react-query";

import { listLearnerServices, serviceLabel } from "./additionalServices";

const rupees = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

function statusChip(status: string | null | undefined) {
  if (status === "full_paid")
    return { text: "Paid", cls: "bg-green-100 text-green-800" };
  if (status === "half_paid")
    return { text: "Half paid", cls: "bg-amber-100 text-amber-800" };
  return { text: "Unpaid", cls: "bg-red-50 text-red-700" };
}

/**
 * Every course / top-up / licence service a learner has, from the enrollment
 * table (the single record of "which learner got what"). Read-only; the
 * Services & payments dialog is where services are sold and payments recorded.
 */
export function LearnerServicesList({
  learnerId,
  compact = false,
}: {
  learnerId: string;
  compact?: boolean;
}) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["learner-services", learnerId],
    staleTime: 30_000,
    queryFn: () => listLearnerServices(learnerId),
  });

  if (isLoading) {
    return <p className="text-xs text-muted-foreground">Loading services…</p>;
  }
  if (isError) {
    return (
      <p className="text-xs text-red-600">Couldn&apos;t load the services.</p>
    );
  }
  const list = data ?? [];
  if (list.length === 0) {
    return <p className="text-xs text-muted-foreground">No services yet.</p>;
  }

  return (
    <ul className={compact ? "space-y-1" : "space-y-2"}>
      {list.map((e) => {
        const chip = statusChip(e.payment_status);
        const created = (e as { created_at?: string }).created_at;
        return (
          <li
            key={e.id}
            className="flex flex-wrap items-center justify-between gap-2 text-sm"
          >
            <span className="min-w-0">
              <span className="font-medium">{serviceLabel(e)}</span>
              {e.amount ? (
                <span className="text-muted-foreground">
                  {" "}
                  · {rupees(e.amount)}
                </span>
              ) : null}
              {created && !compact ? (
                <span className="text-xs text-muted-foreground">
                  {" "}
                  ·{" "}
                  {new Intl.DateTimeFormat("en-GB", {
                    day: "2-digit",
                    month: "short",
                    year: "numeric",
                  }).format(new Date(created))}
                </span>
              ) : null}
            </span>
            <span
              className={`rounded px-2 py-0.5 text-xs font-medium ${chip.cls}`}
            >
              {chip.text}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
