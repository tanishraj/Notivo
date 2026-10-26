// Adapted from the free shadcnblocks sidebar1 block:
// https://www.shadcnblocks.com/block/sidebar1 — https://www.shadcnblocks.com/license
import {
  Activity,
  ArrowUpRight,
  FileText,
  LayoutDashboard,
  LogOut,
  Mail,
  Settings2,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import type { Page, UserProfile } from "../types";
import { initials } from "../lib/recipients";

const pages = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "notices", label: "Notice archive", icon: FileText },
  { id: "emails", label: "Email activity", icon: Mail },
  { id: "runs", label: "Check history", icon: Activity },
] as const;

export function Brand() {
  return (
    <div className="brand">
      <svg viewBox="0 0 40 40" aria-hidden="true">
        <rect width="40" height="40" rx="11" fill="currentColor" />
        <path
          d="M12 28V12l16 16V12"
          fill="none"
          stroke="white"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx="29" cy="10" r="4" fill="#8fd19a" />
      </svg>
      <span>
        notivo<span className="brand-dot">.</span>
      </span>
    </div>
  );
}

export function AppSidebar({
  page,
  onNavigate,
  onLogout,
  user,
}: {
  page: Page;
  onNavigate: (page: Page) => void;
  onLogout: () => void;
  user: UserProfile | null;
}) {
  const { setOpenMobile } = useSidebar();
  function navigate(next: Page) {
    onNavigate(next);
    setOpenMobile(false);
  }
  return (
    <Sidebar>
      <SidebarHeader className="brand-header">
        <a
          href="#overview"
          aria-label="Notivo overview"
          onClick={() => navigate("overview")}
        >
          <Brand />
        </a>
        <p>Important updates, delivered.</p>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Workspace</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {pages.map(({ id, label, icon: Icon }) => (
                <SidebarMenuItem key={id}>
                  <SidebarMenuButton asChild isActive={page === id}>
                    <a
                      href={`#${id}`}
                      onClick={() => navigate(id)}
                      aria-current={page === id ? "page" : undefined}
                    >
                      <Icon />
                      <span>{label}</span>
                    </a>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarGroup className="source-nav">
          <SidebarGroupLabel>Monitoring</SidebarGroupLabel>
          <div className="source-nav-item">
            <span className="source-monogram">N</span>
            <div>
              <strong>NMC</strong>
              <span>Public notices</span>
            </div>
            <span className="source-dot" aria-hidden="true" />
          </div>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild isActive={page === "settings"}>
              <a
                href="#settings"
                onClick={() => navigate("settings")}
                aria-current={page === "settings" ? "page" : undefined}
              >
                <Settings2 />
                <span>Configuration</span>
              </a>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton asChild>
              <a
                href="https://nmc.org.in/whats-new"
                target="_blank"
                rel="noreferrer"
              >
                <ArrowUpRight />
                <span>Visit NMC website</span>
              </a>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton onClick={onLogout}>
              <LogOut />
              <span>Sign out</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        <div
          className="workspace-owner"
          role="group"
          aria-label="Signed-in account"
        >
          <span aria-hidden="true">
            {user ? initials(user.name || user.email.split("@")[0]!) : "?"}
          </span>
          <div>
            <strong title={user?.name}>{user?.name || "Account"}</strong>
            <small title={user?.email}>
              {user?.email || "Account details unavailable"}
            </small>
          </div>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
