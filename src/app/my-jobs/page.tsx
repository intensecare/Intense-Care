"use client";

import { FieldJobList } from "@/components/field/FieldJobFlow";

/** Field Manager / Team Leader home — "My Jobs" (§8). */
export default function MyJobsPage() {
  return <FieldJobList mode="manager" />;
}
