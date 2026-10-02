import React, { Component, ErrorInfo, ReactNode } from "react";

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
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error("ErrorBoundary caught an error:", error, errorInfo);
  }

  // "Try again" cannot work on its own: React does not re-run the render that
  // threw, so a retried subtree that throws again lands in the same dead state
  // with no way out. Reset plus a reload is the only genuine recovery, and it
  // is what recovering a corrupted Supabase session actually requires.
  reset = (): void => {
    window.location.reload();
  };

  render(): ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
          <h1 className="text-2xl font-bold">Something went wrong</h1>
          <p className="max-w-xl text-sm text-muted-foreground">
            {this.state.error?.message || "An unexpected error occurred."}
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <Button onClick={this.reset} variant="default">
              Reload the page
            </Button>
            <a
              className="text-sm underline underline-offset-4"
              href={import.meta.env.BASE_URL || "/"}
            >
              Go to home
            </a>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
