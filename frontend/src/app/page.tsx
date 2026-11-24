import { AuthControls } from "@/src/features/auth/components/AuthControls";
import { AuthProvider } from "@/src/features/auth/components/AuthProvider";
import { SitesWorkspace } from "@/src/features/sites/components/SitesWorkspace";

export default function Home() {
  return (
    <AuthProvider>
      <SitesWorkspace headerActions={<AuthControls />} />
    </AuthProvider>
  );
}
