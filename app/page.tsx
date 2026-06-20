import { AppShell } from "@/components/AppShell";

// The single static-export entry. AppShell owns the projects home and the
// editor; no account is required to start writing.
export default function Home() {
  return <AppShell />;
}
