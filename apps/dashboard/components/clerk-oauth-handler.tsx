'use client';

import { useEffect } from 'react';
import { isTauri } from '@/lib/tauri-utils';

function isOAuthUrl(url: string): boolean {
  try {
    const parsed = new URL(url, window.location.origin);
    const hostname = parsed.hostname.toLowerCase();
    const currentHostname = window.location.hostname.toLowerCase();

    if (hostname === currentHostname) {
      return false;
    }

    if (
      hostname === 'accounts.google.com' ||
      hostname === 'appleid.apple.com' ||
      hostname === 'oauth.clerk.com' ||
      hostname.endsWith('.accounts.dev')
    ) {
      return true;
    }

    const isClerkHostedDomain =
      hostname.startsWith('clerk.') ||
      hostname.includes('.clerk.') ||
      hostname.includes('.clerk.accounts.');
    const hasOAuthPath =
      parsed.pathname.toLowerCase().includes('oauth') ||
      parsed.pathname.toLowerCase().includes('sso');

    return isClerkHostedDomain && hasOAuthPath;
  } catch {
    return false;
  }
}

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

      if (isOAuthUrl(urlString)) {
        console.log('🔐 OAuth URL detected in window.open, opening in system browser');
        
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
    
    // Intercept history.pushState and replaceState to catch OAuth redirects
    const originalPushState = window.history.pushState;
    const originalReplaceState = window.history.replaceState;
    
    window.history.pushState = function(...args) {
      const url = args[2];
      if (url) {
        const urlString = url.toString();

        if (isOAuthUrl(urlString)) {
          console.log('🔐 OAuth URL detected in pushState, opening in system browser:', urlString);
          import('@tauri-apps/api/shell').then(({ open }) => {
            open(urlString);
          });
          return; // Don't actually push state
        }
      }
      return originalPushState.apply(window.history, args);
    };
    
    window.history.replaceState = function(...args) {
      const url = args[2];
      if (url) {
        const urlString = url.toString();

        if (isOAuthUrl(urlString)) {
          console.log('🔐 OAuth URL detected in replaceState, opening in system browser:', urlString);
          import('@tauri-apps/api/shell').then(({ open }) => {
            open(urlString);
          });
          return; // Don't actually replace state
        }
      }
      return originalReplaceState.apply(window.history, args);
    };

    // Also intercept navigation attempts (in case Clerk redirects instead of using window.open)
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      const newUrl = (e.target as any)?.activeElement?.href;
      if (newUrl) {
        console.log('🌐 Navigation detected:', newUrl);

        if (isOAuthUrl(newUrl)) {
          console.log('🔐 OAuth navigation detected, opening in system browser');
          e.preventDefault();
          
          import('@tauri-apps/api/shell').then(({ open }) => {
            open(newUrl);
          });
        }
      }
    };

    // Function to attach OAuth interceptors to buttons
    const attachOAuthInterceptors = () => {
      // Find all potential OAuth buttons
      const buttons = document.querySelectorAll('button');
      buttons.forEach((button) => {
        const buttonText = button.textContent?.toLowerCase() || '';
        const buttonHTML = button.outerHTML?.toLowerCase() || '';
        const isGoogleButton = buttonText.includes('google') || buttonHTML.includes('google');
        const isAppleButton = buttonText.includes('apple') || buttonHTML.includes('apple');
        
        if ((isGoogleButton || isAppleButton) && !button.hasAttribute('data-oauth-intercepted')) {
          button.setAttribute('data-oauth-intercepted', 'true');
          const provider = isGoogleButton ? 'Google' : 'Apple';
          console.log(`🔐 Attaching interceptor to ${provider} button`);
          
          // Don't prevent the click - let Clerk start the OAuth flow
          // Our overrides of location.assign/replace will catch the redirect
          console.log(`🔐 ${provider} button ready - navigation interceptors are active`);
        }
      });
    };
    
    // Initial attachment
    attachOAuthInterceptors();
    
    // Watch for new OAuth buttons being added (Clerk renders them dynamically)
    const observer = new MutationObserver(() => {
      attachOAuthInterceptors();
    });
    
    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
    
    // Intercept clicks on OAuth buttons
    const handleClick = async (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const button = target.closest('button');
      const link = target.closest('a');
      
      // Check if this is a Clerk OAuth button (Google or Apple)
      if (button && button.hasAttribute('data-oauth-intercepted')) {
        // Already handled by our interceptor
        return;
      }
      
      // Also check for direct OAuth links
      if (link?.href) {
        if (isOAuthUrl(link.href)) {
          console.log('🔐 OAuth link clicked, opening in system browser:', link.href);
          e.preventDefault();
          e.stopPropagation();
          
          import('@tauri-apps/api/shell').then(({ open }) => {
            open(link.href);
          });
          return false;
        }
      }
    };
    
    let currentHref = window.location.href;
    let redirectIntercepted = false;
    
    // Monitor for location changes (Clerk uses window.location.href = ...)
    const checkLocation = () => {
      if (window.location.href !== currentHref && !redirectIntercepted) {
        const newUrl = window.location.href;

        if (isOAuthUrl(newUrl)) {
          redirectIntercepted = true;
          console.log('🔐 OAuth redirect detected, opening in system browser:', newUrl);
          
          // Restore the original href immediately
          window.history.replaceState(null, '', currentHref);
          
          // Open in system browser
          import('@tauri-apps/api/shell').then(({ open }) => {
            open(newUrl);
          });
          
          // Reset flag after a delay
          setTimeout(() => {
            redirectIntercepted = false;
            currentHref = window.location.href;
          }, 1000);
          
          return;
        }
        
        currentHref = newUrl;
      }
    };
    
    // Poll for location changes to catch redirects (10ms was blocking the UI thread)
    const locationCheckInterval = setInterval(checkLocation, 200);

    window.addEventListener('beforeunload', handleBeforeUnload);
    document.addEventListener('click', handleClick, true);

    // Cleanup: restore original methods and remove event listeners
    return () => {
      window.open = originalWindowOpen;
      window.history.pushState = originalPushState;
      window.history.replaceState = originalReplaceState;
      window.removeEventListener('beforeunload', handleBeforeUnload);
      document.removeEventListener('click', handleClick, true);
      observer.disconnect();
      clearInterval(locationCheckInterval);
    };
  }, []);

  return null;
}
