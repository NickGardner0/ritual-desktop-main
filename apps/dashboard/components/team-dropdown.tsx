"use client";

import { cn } from "@/lib/utils";
import { useUser, useClerk } from "@clerk/nextjs";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useState, useRef } from "react";
import { useOnClickOutside } from "usehooks-ts";
import { BrailleSpinner } from "@/components/ui/braille-spinner";

interface TeamDropdownProps {
  isExpanded: boolean;
  placement?: 'sidebar' | 'header';
}

export function TeamDropdown({ isExpanded, placement = 'sidebar' }: TeamDropdownProps) {
  const { user } = useUser();
  const { signOut, openUserProfile } = useClerk();
  const [isActive, setActive] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useOnClickOutside(ref as React.RefObject<HTMLElement>, () => setActive(false));

  const handleSignOut = async () => {
    console.log('🔐 User initiated sign out...');
    setIsSigningOut(true);
    setActive(false); // Close dropdown immediately
    
    try {
      await signOut();
      // AuthContext will handle the redirect
    } catch (error) {
      console.error('Sign out error:', error);
      // AuthContext will still handle the redirect even on error
    } finally {
      setIsSigningOut(false);
    }
  };

  const handleAccount = () => {
    setActive(false);
    openUserProfile();
  };

  const handleSupport = () => {
    console.log('Support clicked');
    setActive(false);
  };

  const getUserInitial = () => {
    const firstName = user?.firstName?.trim();
    if (firstName) return firstName.charAt(0).toUpperCase();

    const fullName = user?.fullName?.trim();
    if (fullName) return fullName.charAt(0).toUpperCase();

    const email = user?.primaryEmailAddress?.emailAddress;
    if (!email) return 'R';
    return email.charAt(0).toUpperCase();
  };

  const getUserName = () => {
    const email = user?.primaryEmailAddress?.emailAddress;
    return user?.fullName || user?.firstName || email?.split('@')[0] || 'Ritual User';
  };

  // Header placement (top right)
  if (placement === 'header') {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" className="relative h-8 w-8 rounded-none hover:bg-transparent p-0">
            <Avatar className="h-8 w-8 rounded-none border border-[#E5E7EB]">
              <AvatarFallback className="text-xs rounded-none bg-[#F9F9F9] text-[#3d3b30]">
                {getUserInitial()}
              </AvatarFallback>
            </Avatar>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-[220px] p-1.5 rounded-none border border-gray-200" align="end" forceMount>
          <div className="px-2.5 py-2">
            <p className="text-sm font-medium text-gray-900">{getUserName()}</p>
            <p className="text-xs text-gray-500">
              {user?.primaryEmailAddress?.emailAddress}
            </p>
          </div>
          
          <div className="h-px bg-gray-200 my-1" />
          
          <div className="py-0.5">
            <DropdownMenuItem onClick={handleAccount} className="rounded-none px-2.5 py-1.5 text-sm text-gray-700 hover:bg-[#F3F3F3] focus:bg-[#F3F3F3] cursor-pointer">
              Account
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleSupport} className="rounded-none px-2.5 py-1.5 text-sm text-gray-700 hover:bg-[#F3F3F3] focus:bg-[#F3F3F3] cursor-pointer">
              Support
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleSupport} className="rounded-none px-2.5 py-1.5 text-sm text-gray-700 hover:bg-[#F3F3F3] focus:bg-[#F3F3F3] cursor-pointer">
              Teams
            </DropdownMenuItem>
          </div>
          
          <div className="h-px bg-gray-200 my-1" />
          
          <div className="py-0.5">
            <DropdownMenuItem onClick={handleSignOut} disabled={isSigningOut} className="rounded-none px-2.5 py-1.5 text-sm text-gray-700 hover:bg-[#F3F3F3] focus:bg-[#F3F3F3] cursor-pointer">
              {isSigningOut ? (
                <>
                  <BrailleSpinner className="mr-2 text-sm text-gray-600" />
                  <span>Signing out...</span>
                </>
              ) : (
                <span>Sign out</span>
              )}
            </DropdownMenuItem>
          </div>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  // Sidebar placement — inline in sidebar flex layout (no position:fixed)
  return (
    <div className="relative w-full" ref={ref}>
      {/* Avatar row */}
      <div
        className={cn(
          "flex items-center h-[32px] cursor-pointer",
          isExpanded ? "gap-2 px-1" : "justify-center",
        )}
        onClick={() => setActive(!isActive)}
      >
        <Avatar className="w-[32px] h-[32px] rounded-none border border-[#E5E7EB] flex-shrink-0">
          <AvatarFallback className="team-avatar-tile rounded-none w-[32px] h-[32px] bg-[#F9F9F9] text-[#3d3b30]">
            <span className="text-xs font-medium">{getUserInitial()}</span>
          </AvatarFallback>
        </Avatar>
        {isExpanded && (
          <span className="text-sm text-primary truncate hover:opacity-80">
            {getUserName()}
          </span>
        )}
      </div>

      {/* Dropdown menu — absolute, positioned above the avatar */}
      {isActive && (
        <div
          className={cn(
            "team-dropdown-menu absolute bottom-[40px] z-50 border border-[#DCDAD2] bg-[#FFFFFF] rounded-none shadow-none",
            isExpanded ? "left-0 right-0 w-auto" : "left-0 w-56",
          )}
        >
          <div className="p-2 border-b border-[#DCDAD2] team-dropdown-divider">
            <p className="text-sm font-medium text-black">{getUserName()}</p>
            <p className="text-xs text-black">{user?.primaryEmailAddress?.emailAddress}</p>
          </div>

          <div className="p-1">
            <button
              onClick={handleAccount}
              className="team-dropdown-row w-full cursor-pointer px-2 py-1 text-left text-sm text-black rounded-none hover:bg-gray-100 focus:bg-gray-100"
            >
              Profile
            </button>

            <button
              onClick={handleSupport}
              className="team-dropdown-row w-full cursor-pointer px-2 py-1 text-left text-sm text-black rounded-none hover:bg-gray-100 focus:bg-gray-100"
            >
              Support
            </button>
          </div>

          <div className="border-t border-[#DCDAD2] p-1 team-dropdown-divider">
            <button
              onClick={handleSignOut}
              disabled={isSigningOut}
              className="team-dropdown-row w-full cursor-pointer px-2 py-1 text-left text-sm text-black rounded-none hover:bg-gray-100 focus:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSigningOut ? "Signing out..." : "Sign out"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
