import Link from "next/link";
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
            <div className="w-full max-w-[440px]">
                {isDesktopApp ? <ClerkOAuthHandler /> : null}
                <div className="ritual-sign-in-shell overflow-hidden rounded-[18px] border border-[#E5E7EB] bg-white shadow-[0_18px_48px_rgba(17,24,39,0.10)]">
                    <div className="px-10 pb-8 pt-9">
                        <div className="mb-7 flex justify-center">
                            <div className="flex items-center gap-2 text-[#111827]">
                                <img
                                    src="/images/eclipse.svg"
                                    alt="Ritual"
                                    className="h-5 w-5 object-contain"
                                />
                                <span className="text-[17px] font-semibold tracking-[-0.02em]">
                                    Ritual
                                </span>
                            </div>
                        </div>
                        <div className="mb-7 text-center">
                            <h1 className="text-[18px] font-semibold tracking-[-0.01em] text-[#111827]">
                                Sign in to Ritual
                            </h1>
                            <p className="mt-2 text-[13px] text-[#6B7280]">
                                Welcome back! Please sign in to continue
                            </p>
                        </div>
                        <SignIn
                            appearance={{
                                layout: {
                                    socialButtonsPlacement: 'top',
                                    socialButtonsVariant: 'blockButton',
                                },
                                variables: {
                                    borderRadius: '0.625rem',
                                },
                                elements: {
                                    rootBox: "mx-auto w-full",
                                    cardBox: "!w-full",
                                    card: "!w-full !max-w-none !shadow-none !border-0 !rounded-none !bg-transparent !p-0",
                                    header: "hidden",
                                    socialButtonsRoot: "mb-5",
                                    socialButtons: "mb-0",
                                    socialButtonsBlockButton: "!h-11 !w-full !justify-center !rounded-[10px] !border !border-[#E5E7EB] !bg-white !px-4 !py-2 !shadow-none",
                                    socialButtonsBlockButtonText: "text-[14px] font-medium text-[#111827]",
                                    socialButtonsProviderIcon: "h-4 w-4",
                                    lastAuthenticationStrategyBadge: "hidden",
                                    dividerRow: "my-5",
                                    dividerText: "text-[13px] text-[#6B7280]",
                                    formFieldLabel: "text-[13px] font-medium text-[#111827]",
                                    formFieldInput: "rounded-[10px] h-11 text-[14px] border-[#E5E7EB] shadow-none",
                                    formButtonPrimary: "!mt-1 rounded-[10px] h-11 text-[14px] font-medium",
                                    footer: "hidden",
                                    footerAction: "hidden",
                                    footerActionText: "hidden",
                                    footerActionLink: "hidden",
                                }
                            }}
                            routing="path"
                            path="/sign-in"
                            signUpUrl="/sign-up"
                            forceRedirectUrl="/auth/sso-callback"
                            fallbackRedirectUrl="/auth/sso-callback"
                            oauthFlow={isDesktopApp ? "redirect" : "auto"}
                            oidcPrompt={isDesktopApp ? "select_account" : undefined}
                            fallback={<div className="h-[290px]" />}
                        />
                    </div>
                    <div className="border-t border-[#E5E7EB] bg-[#FAFAF9] px-10 py-4 text-center text-[14px] text-[#6B7280]">
                        Don&apos;t have an account?{' '}
                        <Link href="/sign-up" className="font-semibold text-[#111827] hover:text-[#111827]">
                            Sign up
                        </Link>
                    </div>
                </div>
            </div>
            <style>{`
                .ritual-sign-in-shell .cl-cardBox {
                    width: 100%;
                }

                .ritual-sign-in-shell .cl-rootBox {
                    width: 100%;
                }

                .ritual-sign-in-shell .cl-socialButtonsRoot {
                    width: 100%;
                }

                .ritual-sign-in-shell .cl-socialButtons {
                    display: grid !important;
                    grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
                    gap: 12px !important;
                    width: 100% !important;
                }

                .ritual-sign-in-shell .cl-socialButtons > * {
                    width: 100% !important;
                    min-width: 0 !important;
                }

                .ritual-sign-in-shell .cl-socialButtonsBlockButton {
                    width: 100% !important;
                    max-width: none !important;
                    min-height: 44px !important;
                    padding: 10px 14px !important;
                    justify-content: center !important;
                }

                .ritual-sign-in-shell .cl-socialButtonsBlockButtonText {
                    font-size: 14px;
                    font-weight: 500;
                    white-space: nowrap;
                }

                .ritual-sign-in-shell .cl-socialButtonsBlockButtonArrow,
                .ritual-sign-in-shell .cl-footer,
                .ritual-sign-in-shell .cl-badge,
                .ritual-sign-in-shell .cl-lastAuthenticationStrategyBadge,
                .ritual-sign-in-shell [class*="badge"] {
                    display: none !important;
                }

                .ritual-sign-in-shell .cl-formFieldLabelRow {
                    margin-bottom: 6px;
                }

                .ritual-sign-in-shell .cl-dividerRow {
                    margin-block: 20px;
                }

                .ritual-sign-in-shell .cl-dividerLine {
                    background: #E5E7EB;
                }

                .ritual-sign-in-shell .cl-footer,
                .ritual-sign-in-shell .cl-footerAction,
                .ritual-sign-in-shell .cl-footerActionText,
                .ritual-sign-in-shell .cl-footerActionLink {
                    display: none !important;
                }
            `}</style>
        </div>
    );
}
