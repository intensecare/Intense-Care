"use client";

import React, { Component, ErrorInfo, ReactNode } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("ErrorBoundary caught an error:", error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
          <div className="max-w-md w-full bg-white rounded-lg border border-slate-200 shadow-lg p-6 space-y-4">
            <div className="flex items-center gap-3 text-red-600">
              <AlertTriangle className="h-8 w-8" />
              <h2 className="text-lg font-semibold">Something went wrong</h2>
            </div>
            
            <div className="bg-slate-50 rounded-lg border border-slate-200 p-4">
              <p className="text-sm text-slate-600 mb-2">An unexpected error occurred:</p>
              <p className="text-xs font-mono text-slate-800 bg-white p-2 rounded border border-slate-200">
                {this.state.error?.message || "Unknown error"}
              </p>
            </div>

            <p className="text-sm text-slate-500">
              Please refresh the page and try again. If the problem persists, contact your administrator.
            </p>

            <Button
              onClick={() => window.location.reload()}
              className="w-full gap-2"
            >
              <RefreshCw className="h-4 w-4" />
              Refresh Page
            </Button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
