import { SignIn } from "@clerk/nextjs";
import { ClerkOAuthHandler } from '@/components/clerk-oauth-handler';

export default function SignInPage() {
    return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
            <ClerkOAuthHandler />
            <div className="w-full max-w-md space-y-8 flex justify-center">
                <SignIn
                    appearance={{
                        elements: {
                            rootBox: "mx-auto",
                            card: "shadow-sm rounded-lg",
                        }
                    }}
                    signUpUrl="/sign-up"
                    forceRedirectUrl="/auth/sso-callback"
                    fallbackRedirectUrl="/auth/sso-callback"
                />
            </div>
        </div>
    );
}
