"use client";

import { Suspense } from "react";
import { useParams } from "next/navigation";
import { FieldJobFlow } from "@/components/field/FieldJobFlow";

export default function MyJobPage() {
  const params = useParams();
  return (
    <Suspense>
      <FieldJobFlow jobId={String(params?.id ?? "")} />
    </Suspense>
  );
}
