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
            <div className="w-full max-w-[520px]">
                {isDesktopApp ? <ClerkOAuthHandler /> : null}
                <div className="flex justify-center">
                    <div className="ritual-sign-in-card relative w-full">
                        <div className="pointer-events-none absolute inset-x-0 top-6 z-10 flex justify-center">
                            <div className="flex items-center gap-2 text-[#111827]">
                                <img
                                    src="/images/eclipse.svg"
                                    alt="Ritual"
                                    className="h-5 w-5 object-contain"
                                />
                                <span className="text-[20px] font-semibold tracking-[-0.02em]">
                                    Ritual
                                </span>
                            </div>
                        </div>
                        <SignIn
                            appearance={{
                                variables: {
                                    borderRadius: '0.125rem',
                                },
                                elements: {
                                    rootBox: "mx-auto w-full",
                                    card: "shadow-sm rounded-sm pt-20",
                                    headerTitle: "text-[18px] font-semibold tracking-[-0.01em]",
                                    headerSubtitle: "text-sm text-gray-500",
                                    socialButtons: "grid grid-cols-2 gap-2",
                                    socialButtonsBlockButton: "rounded-sm min-h-[40px] px-3 py-2",
                                    socialButtonsBlockButtonText: "text-[13px] font-medium",
                                    socialButtonsProviderIcon: "h-4 w-4",
                                    socialButtonsBlockButtonArrow: "hidden",
                                    dividerRow: "my-4",
                                    formFieldInput: "rounded-sm h-10",
                                    formButtonPrimary: "rounded-sm h-10",
                                }
                            }}
                            signUpUrl="/sign-up"
                            forceRedirectUrl="/auth/sso-callback"
                            fallbackRedirectUrl="/auth/sso-callback"
                            oauthFlow={isDesktopApp ? "redirect" : "auto"}
                            oidcPrompt={isDesktopApp ? "select_account" : undefined}
                        />
                    </div>
                </div>
            </div>
            <style>{`
                .ritual-sign-in-card .cl-card {
                    width: 100%;
                    max-width: 520px;
                    border-radius: 0.125rem;
                    box-shadow: 0 18px 48px rgba(17, 24, 39, 0.10);
                }

                .ritual-sign-in-card .cl-headerTitle {
                    margin-top: 0;
                }

                .ritual-sign-in-card .cl-socialButtons {
                    display: grid;
                    grid-template-columns: repeat(2, minmax(0, 1fr));
                    gap: 10px;
                }

                .ritual-sign-in-card .cl-socialButtonsBlockButton {
                    min-height: 40px;
                    padding: 8px 12px;
                }

                .ritual-sign-in-card .cl-socialButtonsBlockButtonText {
                    font-size: 13px;
                    font-weight: 500;
                    white-space: nowrap;
                }

                .ritual-sign-in-card .cl-socialButtonsBlockButtonArrow,
                .ritual-sign-in-card .cl-badge {
                    display: none !important;
                }

                .ritual-sign-in-card .cl-dividerRow {
                    margin-block: 16px;
                }
            `}</style>
        </div>
    );
}
