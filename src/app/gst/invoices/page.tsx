"use client";

import React from "react";
import { AdminLayout } from "@/components/common/AdminLayout";
import { PageHeader } from "@/components/common/PageHeader";
import { InvoiceList } from "@/components/invoice/InvoiceList";

/** GST invoices only — the server never returns anything else to a Tax Officer. */
export default function GstInvoicesPage() {
  return (
    <AdminLayout>
      <PageHeader title="GST Invoices" description="Search by invoice number, Job ID, customer or GSTIN. Open one to see the GST breakdown or print it." />
      <InvoiceList basePath="/gst/invoices" fixedType="GST" gstColumns />
    </AdminLayout>
  );
}
