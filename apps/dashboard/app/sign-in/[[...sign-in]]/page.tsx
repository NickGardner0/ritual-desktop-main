import { SignIn } from "@clerk/nextjs";
import { headers } from 'next/headers';

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
                {isDesktopApp ? <ClerkOAuthHandler /> : null}
                <div className="flex justify-center">
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
                    signUpUrl="/sign-up"
                    forceRedirectUrl="/auth/sso-callback"
                    fallbackRedirectUrl="/auth/sso-callback"
                />
                </div>
            </div>
        </div>
    );
}
