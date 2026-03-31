import { SignUp } from "@clerk/nextjs";
import { headers } from 'next/headers';

import { ClerkOAuthHandler } from '@/components/clerk-oauth-handler';
import { DesktopSocialAuthButtons } from '@/components/desktop-social-auth-buttons';

function isDesktopUserAgent(userAgent: string): boolean {
    return userAgent.includes('RitualDesktop/');
}

export default async function SignUpPage() {
    const headerStore = await headers();
    const userAgent = headerStore.get('user-agent') || '';
    const isDesktopApp = isDesktopUserAgent(userAgent);

    return (
        <div className="min-h-screen flex items-center justify-center bg-white py-12 px-4 sm:px-6 lg:px-8">
            <div className="w-full max-w-md">
                {isDesktopApp ? <ClerkOAuthHandler /> : null}
                <div className="flex justify-center">
                    <div className="w-full">
                        {isDesktopApp ? <DesktopSocialAuthButtons mode="sign-up" /> : null}
                        <SignUp
                            appearance={{
                                variables: {
                                    borderRadius: '0.125rem',
                                },
                                elements: {
                                    rootBox: "mx-auto",
                                    card: "shadow-sm rounded-sm",
                                    formButtonPrimary: "rounded-sm",
                                    socialButtonsBlockButton: isDesktopApp ? "hidden" : "rounded-sm",
                                    dividerRow: isDesktopApp ? "hidden" : "",
                                    formFieldInput: "rounded-sm",
                                    footerActionText: "text-gray-600",
                                    footerActionLink: "text-blue-600 hover:text-blue-500"
                                }
                            }}
                            signInUrl="/sign-in"
                            forceRedirectUrl="/auth/sso-callback"
                            fallbackRedirectUrl="/auth/sso-callback"
                        />
                    </div>
                </div>
            </div>
        </div>
    );
}
