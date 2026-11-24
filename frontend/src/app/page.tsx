import { AuthControls } from "@/src/features/auth/AuthControls";
import { AuthProvider } from "@/src/features/auth/AuthContext";
import { SitesWorkspace } from "@/src/features/sites/SitesWorkspace";

export default function Home() {
  return (
    <AuthProvider>
      <SitesWorkspace headerActions={<AuthControls />} />
    </AuthProvider>
  );
}
