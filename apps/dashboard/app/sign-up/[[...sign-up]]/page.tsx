import { SignUp } from "@clerk/nextjs";
import { headers } from 'next/headers';

import { AuthFlowIntent } from '@/components/auth-flow-intent';
import { ClerkOAuthHandler } from '@/components/clerk-oauth-handler';

function isDesktopUserAgent(userAgent: string): boolean {
    return userAgent.includes('RitualDesktop/');
}

export default async function SignUpPage() {
    const headerStore = await headers();
    const userAgent = headerStore.get('user-agent') || '';
    const isDesktopApp = isDesktopUserAgent(userAgent);

    return (
        <div className="ritual-onboarding-font min-h-screen flex items-center justify-center bg-[#fcfcfa] py-12 px-4 sm:px-6 lg:px-8">
            <div className="w-full max-w-md">
                <AuthFlowIntent mode="sign_up" />
                {isDesktopApp ? <ClerkOAuthHandler mode="sign_up" desktopMode /> : null}
                <div className="flex justify-center">
                    <SignUp
                        appearance={{
                            variables: {
                                borderRadius: '0.125rem',
                                fontFamily: "'FK Grotesk Neue', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
                                fontFamilyButtons: "'FK Grotesk Neue', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
                            },
                            elements: {
                                rootBox: "mx-auto",
                                card: "shadow-sm rounded-sm",
                                formButtonPrimary: "rounded-sm",
                                socialButtonsBlockButton: "rounded-sm",
                                dividerRow: "",
                                formFieldInput: "rounded-sm",
                                footerActionText: "text-gray-600",
                                footerActionLink: "text-blue-600 hover:text-blue-500"
                            }
                        }}
                        signInUrl="/sign-in"
                        forceRedirectUrl="/auth/sso-callback"
                        fallbackRedirectUrl="/auth/sso-callback"
                        oauthFlow={isDesktopApp ? "redirect" : "auto"}
                        oidcPrompt={isDesktopApp ? "select_account" : undefined}
                    />
                </div>
            </div>
        </div>
    );
}
