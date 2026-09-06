import { DetachedSidebarShell } from "@/components/detached-sidebar-shell";
import { FontProvider } from "@/contexts/FontContext";

export default function SidebarWindowPage() {
  return (
    <FontProvider>
      <DetachedSidebarShell />
    </FontProvider>
  );
}
