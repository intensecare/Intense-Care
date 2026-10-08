"use client";

import { LogOut } from "lucide-react";
import { Button, Card } from "@/components/ui";
import { PasswordForm } from "@/components/admin/forms";
import { useSignOut } from "@/components/shells";

export function ProfileView({ name, email, phone, roleLabel }: { name: string; email: string; phone: string; roleLabel: string }) {
  const signOut = useSignOut();
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-slate-900">Profile</h1>
      <Card className="p-4">
        <div className="text-lg font-semibold text-slate-900">{name}</div>
        <div className="text-sm text-slate-600">{roleLabel}</div>
        <div className="mt-2 text-sm text-slate-500 break-all">{email}</div>
        {phone && <div className="text-sm text-slate-500">{phone}</div>}
      </Card>
      <Card className="p-4">
        <h2 className="mb-3 text-base font-semibold text-slate-900">Change password</h2>
        <PasswordForm />
      </Card>
      <Button variant="secondary" size="lg" className="w-full" onClick={signOut}>
        <LogOut className="h-5 w-5" /> Sign out
      </Button>
    </div>
  );
}
