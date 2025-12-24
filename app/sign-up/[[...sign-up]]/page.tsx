import { SignUp } from "@clerk/nextjs";
import { ClerkOAuthHandler } from '@/components/clerk-oauth-handler';

export default function SignUpPage() {
    return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
            <ClerkOAuthHandler />
            <div className="w-full max-w-md space-y-8 flex justify-center">
                <SignUp
                    appearance={{
                        elements: {
                            rootBox: "mx-auto",
                            card: "shadow-sm rounded-lg",
                            footerActionText: "text-gray-600",
                            footerActionLink: "text-blue-600 hover:text-blue-500"
                        }
                    }}
                    signInUrl="/sign-in"
                    forceRedirectUrl="/auth/sso-callback"
                />
            </div>
        </div>
    );
}
