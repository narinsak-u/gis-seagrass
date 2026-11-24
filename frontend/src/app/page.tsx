import { AuthControls } from "@/src/features/auth/AuthControls";
import { AuthProvider } from "@/src/features/auth/AuthContext";
import { MapWorkspace } from "@/src/features/map/MapWorkspace";

export default function Home() {
  return (
    <AuthProvider>
      <MapWorkspace headerActions={<AuthControls />} />
    </AuthProvider>
  );
}
