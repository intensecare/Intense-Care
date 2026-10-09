"use client";

import React, { useState } from "react";
import { AdminLayout } from "@/components/common/AdminLayout";
import { PageHeader } from "@/components/common/PageHeader";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Notice } from "@/components/ui/states";
import { AttendanceTab, FreelanceTab, LeaveTab, PayrollTab, StaffTab } from "@/components/hr/HrTabs";
import { useAuth } from "@/lib/auth-context";

/** Admin → HR: staff and freelancers, attendance, leave, payroll and freelance payments. */
export default function HrPage() {
  const { can } = useAuth();
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  return (
    <AdminLayout>
      <PageHeader title="HR" description="Staff and freelancers, attendance, leave, payroll and freelance payments. Paid salaries and freelance payments are added to Expenses automatically." />
      {notice && <Notice tone={notice.tone} className="mb-4">{notice.text}</Notice>}
      <Tabs defaultValue="staff" className="space-y-4">
        <TabsList className="max-w-full overflow-x-auto">
          <TabsTrigger value="staff">Staff</TabsTrigger>
          <TabsTrigger value="attendance">Attendance</TabsTrigger>
          <TabsTrigger value="leave">Leave</TabsTrigger>
          {can("payroll.manage") && <TabsTrigger value="payroll">Payroll</TabsTrigger>}
          {can("freelance.manage") && <TabsTrigger value="freelance">Freelance pay</TabsTrigger>}
        </TabsList>
        <TabsContent value="staff"><StaffTab notify={setNotice} canManage={can("hr.manage")} /></TabsContent>
        <TabsContent value="attendance"><AttendanceTab notify={setNotice} /></TabsContent>
        <TabsContent value="leave"><LeaveTab notify={setNotice} /></TabsContent>
        {can("payroll.manage") && <TabsContent value="payroll"><PayrollTab notify={setNotice} /></TabsContent>}
        {can("freelance.manage") && <TabsContent value="freelance"><FreelanceTab notify={setNotice} /></TabsContent>}
      </Tabs>
    </AdminLayout>
  );
}
