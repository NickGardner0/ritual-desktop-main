'use client';

import { useEffect } from 'react';
import { isTauri } from '@/lib/tauri-utils';

/**
 * Component that configures window.open to use system browser in Tauri
 * This makes Clerk OAuth automatically open in external browser
 */
export function ClerkOAuthHandler() {
  useEffect(() => {
    console.log('🔍 ClerkOAuthHandler mounted');
    console.log('🔍 Is Tauri?', isTauri());
    console.log('🔍 window.__TAURI__:', typeof window !== 'undefined' && '__TAURI__' in window);
    
    if (!isTauri()) {
      console.log('⚠️ Not running in Tauri, OAuth handler disabled');
      return;
    }

    console.log('🔐 Configuring Tauri to open OAuth in system browser');

    // Store the original window.open
    const originalWindowOpen = window.open;

    // Override window.open to use Tauri's shell.open for OAuth URLs
    window.open = function(url?: string | URL, target?: string, features?: string) {
      if (!url) return originalWindowOpen.call(window, url, target, features);

      const urlString = url.toString();
      console.log('🌐 window.open intercepted:', urlString);

      // Check if this is an OAuth URL (Google, Apple, etc.)
      const isOAuth = urlString.includes('accounts.google.com') ||
                     urlString.includes('appleid.apple.com') ||
                     urlString.includes('oauth') ||
                     urlString.includes('auth');

      if (isOAuth) {
        console.log('🔐 OAuth URL detected, opening in system browser');
        
        // Use Tauri's shell to open in system browser
        import('@tauri-apps/api/shell').then(({ open }) => {
          open(urlString);
        }).catch(err => {
          console.error('Failed to open in system browser:', err);
          return originalWindowOpen.call(window, url, target, features);
        });

        // Return null since we're handling it externally
        return null;
      }

      // For non-OAuth URLs, use the original window.open
      return originalWindowOpen.call(window, url, target, features);
    };

    // Also intercept navigation attempts (in case Clerk redirects instead of using window.open)
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      const newUrl = (e.target as any)?.activeElement?.href;
      if (newUrl) {
        console.log('🌐 Navigation detected:', newUrl);
        
        const isOAuth = newUrl.includes('accounts.google.com') ||
                       newUrl.includes('appleid.apple.com') ||
                       newUrl.includes('oauth');
        
        if (isOAuth) {
          console.log('🔐 OAuth navigation detected, opening in system browser');
          e.preventDefault();
          
          import('@tauri-apps/api/shell').then(({ open }) => {
            open(newUrl);
          });
        }
      }
    };

    // Intercept clicks on OAuth buttons
    const handleClick = async (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const button = target.closest('button');
      const link = target.closest('a');
      
      console.log('🖱️ Click detected:', { 
        button: button?.textContent?.trim(), 
        buttonHTML: button?.outerHTML?.substring(0, 200),
        link: link?.href,
        target: target.tagName,
        targetText: target.textContent?.trim()
      });
      
      // Check if this is a Clerk OAuth button (Google or Apple)
      if (button) {
        const buttonText = button.textContent?.toLowerCase() || '';
        const buttonHTML = button.outerHTML?.toLowerCase() || '';
        const isGoogleButton = buttonText.includes('google') || buttonHTML.includes('google');
        const isAppleButton = buttonText.includes('apple') || buttonHTML.includes('apple');
        
        if (isGoogleButton || isAppleButton) {
          const provider = isGoogleButton ? 'Google' : 'Apple';
          console.log(`🔐 ${provider} OAuth button clicked!`);
          console.log(`🌐 Letting Clerk start ${provider} OAuth flow (window.open will intercept)...`);
          
          // Don't prevent default - let Clerk's OAuth flow start
          // Our window.open override will catch the popup
          return;
        }
      }
      
      // Also check for direct OAuth links
      if (link?.href) {
        const isOAuth = link.href.includes('accounts.google.com') ||
                       link.href.includes('appleid.apple.com') ||
                       link.href.includes('oauth');
        
        if (isOAuth) {
          console.log('🔐 OAuth link clicked, opening in system browser:', link.href);
          e.preventDefault();
          e.stopPropagation();
          
          import('@tauri-apps/api/shell').then(({ open }) => {
            open(link.href);
          });
        }
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    document.addEventListener('click', handleClick, true);

    // Cleanup: restore original window.open and remove event listeners
    return () => {
      window.open = originalWindowOpen;
      window.removeEventListener('beforeunload', handleBeforeUnload);
      document.removeEventListener('click', handleClick, true);
    };
  }, []);

  return null;
}

