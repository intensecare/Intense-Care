"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { FieldJobList } from "@/components/field/FieldJobFlow";

function MyJobs() {
  const tab = useSearchParams()?.get("tab") ?? "home";
  return <FieldJobList tab={["home", "jobs", "tasks", "profile"].includes(tab) ? tab : "home"} />;
}

/** Field Manager app — Home · Jobs · Tasks · Profile (only their assigned jobs). */
export default function MyJobsPage() {
  return (
    <Suspense>
      <MyJobs />
    </Suspense>
  );
}
