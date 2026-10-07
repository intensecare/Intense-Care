"use client";

import { useParams } from "next/navigation";
import { FieldJobFlow } from "@/components/field/FieldJobFlow";

export default function MyJobPage() {
  const params = useParams();
  return <FieldJobFlow jobId={String(params?.id ?? "")} mode="manager" />;
}
