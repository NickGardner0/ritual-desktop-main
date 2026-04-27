import { ClerkLoaded, ClerkLoading, SignIn } from "@clerk/nextjs";
import { headers } from 'next/headers';

import { AuthFlowIntent } from '@/components/auth-flow-intent';
import { ClerkOAuthHandler } from '@/components/clerk-oauth-handler';

function isDesktopUserAgent(userAgent: string): boolean {
    return userAgent.includes('RitualDesktop/');
}

export default async function SignInPage() {
    const headerStore = await headers();
    const userAgent = headerStore.get('user-agent') || '';
    const isDesktopApp = isDesktopUserAgent(userAgent);

    return (
        <div className="min-h-screen flex items-center justify-center bg-white py-12 px-4 sm:px-6 lg:px-8">
            <div className="w-full max-w-md">
                <AuthFlowIntent mode="sign_in" />
                {isDesktopApp ? <ClerkOAuthHandler mode="sign_in" desktopMode /> : null}
                <div className="flex justify-center">
                    <ClerkLoading>
                        <div className="h-[420px] w-full" aria-hidden="true" />
                    </ClerkLoading>
                    <ClerkLoaded>
                        <SignIn
                            appearance={{
                                variables: {
                                    borderRadius: '0.125rem',
                                },
                                elements: {
                                    rootBox: "mx-auto",
                                    card: "shadow-sm rounded-sm",
                                    formButtonPrimary: "rounded-sm",
                                    socialButtonsBlockButton: "rounded-sm",
                                    dividerRow: "",
                                    formFieldInput: "rounded-sm",
                                }
                            }}
                            signUpUrl="/?page=1&mode=signup"
                            forceRedirectUrl="/auth/sso-callback"
                            fallbackRedirectUrl="/auth/sso-callback"
                            oauthFlow={isDesktopApp ? "redirect" : "auto"}
                            oidcPrompt={isDesktopApp ? "select_account" : undefined}
                        />
                    </ClerkLoaded>
                </div>
            </div>
        </div>
    );
}
