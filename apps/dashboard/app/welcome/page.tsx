/**
 * Welcome Page - Redirects to Home
 * 
 * The welcome flow has been consolidated into the home page (/).
 * This redirect ensures any old links still work.
 */

import { redirect } from 'next/navigation';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Welcome | Ritual',
  description: 'Get started with Ritual - your habit tracking companion',
};

export default function WelcomePage() {
  redirect('/');
}
