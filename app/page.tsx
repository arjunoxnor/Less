import { ScreenplayEditor } from "@/components/ScreenplayEditor";

// The whole app is currently this one page: the editor. No account is required
// to start writing — signup only gets prompted later, when saving to the cloud.
export default function Home() {
  return <ScreenplayEditor />;
}
