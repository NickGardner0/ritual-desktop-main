"use client";

import { useState } from "react";
import { useClerk, useUser } from "@clerk/nextjs";
import { LogOut, Settings } from "lucide-react";
import { useRouter } from "next/navigation";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { NavRowSurface } from "@/components/ui/ritual-system";
import { signOutOfRitual } from "@/lib/desktop-auth-session";
import { cn } from "@/lib/utils";

type SidebarAccountMenuProps = {
  isExpanded: boolean;
  onOpenChange?: (open: boolean) => void;
  onOpenSettings: () => Promise<void>;
};

export function SidebarAccountMenu({
  isExpanded,
  onOpenChange,
  onOpenSettings,
}: SidebarAccountMenuProps) {
  const { user } = useUser();
  const { signOut } = useClerk();
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);

  const userEmail = user?.primaryEmailAddress?.emailAddress ?? "";
  const userName = user?.fullName
    || user?.firstName
    || userEmail.split("@")[0]
    || "Ritual User";
  const userInitial = userName.trim().charAt(0).toUpperCase() || "R";

  const handleOpenChange = (open: boolean) => {
    setIsOpen(open);
    onOpenChange?.(open);
  };

  const handleOpenSettings = () => {
    handleOpenChange(false);
    void onOpenSettings();
  };

  const handleSignOut = async () => {
    setIsSigningOut(true);
    handleOpenChange(false);

    try {
      await signOutOfRitual(signOut);
      router.push("/");
    } catch (error) {
      console.error("Sign out error:", error);
      setIsSigningOut(false);
    }
  };

  return (
    <DropdownMenu open={isOpen} onOpenChange={handleOpenChange}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            "group/settings-row relative h-[var(--sidebar-row-height)] outline-none",
            isExpanded ? "w-full" : "w-[40px]",
          )}
          aria-label="Settings and account"
          title="Settings and account"
        >
          <NavRowSurface
            active={isOpen}
            expanded={isExpanded}
            className={isExpanded ? "!ml-0 !mr-0 !w-full" : "!ml-0"}
          />
          <span
            className="ritual-nav-icon absolute left-0 top-1/2 flex h-[var(--sidebar-icon-box)] w-[var(--sidebar-icon-box)] -translate-y-1/2 items-center justify-center"
            data-collapsed={!isExpanded ? "true" : undefined}
          >
            <Settings className="relative h-[18px] w-[18px] -translate-y-px" strokeWidth={2.1} />
          </span>
          {isExpanded ? (
            <span className="ritual-nav-label absolute bottom-0 left-[40px] right-[4px] top-0 flex items-center text-sm leading-none">
              Settings
            </span>
          ) : null}
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent
        side="top"
        align="start"
        sideOffset={8}
        collisionPadding={8}
        className="w-[210px] rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-content)] p-1.5 text-[var(--text-primary)] shadow-xl"
      >
        <div className="flex min-w-0 items-center gap-2.5 px-2 py-2">
          <Avatar className="h-7 w-7 border border-[var(--border-subtle)]">
            {user?.imageUrl ? (
              <AvatarImage src={user.imageUrl} alt={userName} />
            ) : null}
            <AvatarFallback className="bg-primary text-[11px] font-medium text-primary-foreground">
              {userInitial}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium leading-5">{userName}</p>
            {userEmail ? (
              <p className="truncate text-xs leading-4 text-[var(--text-muted)]">{userEmail}</p>
            ) : null}
          </div>
        </div>

        <DropdownMenuSeparator className="mx-1 my-1 bg-[var(--border-subtle)]" />

        <DropdownMenuItem
          onSelect={handleOpenSettings}
          className="h-9 cursor-default gap-2.5 rounded-md px-2 text-sm focus:bg-[var(--row-hover)] focus:text-[var(--text-primary)]"
        >
          <Settings className="h-[17px] w-[17px] text-[var(--icon-default)]" strokeWidth={2} />
          <span>Settings</span>
          <span className="ml-auto text-xs text-[var(--text-muted)]">⌘,</span>
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => void handleSignOut()}
          disabled={isSigningOut}
          className="h-9 cursor-default gap-2.5 rounded-md px-2 text-sm focus:bg-[var(--row-hover)] focus:text-[var(--text-primary)]"
        >
          <LogOut className="h-[17px] w-[17px] text-[var(--icon-default)]" strokeWidth={2} />
          <span>{isSigningOut ? "Signing out…" : "Sign out"}</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
