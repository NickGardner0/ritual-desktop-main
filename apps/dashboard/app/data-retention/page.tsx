import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'Data Retention Policy | Ritual',
  description: 'Ritual data deletion and retention policy.',
}

const sections = [
  {
    title: 'Purpose',
    paragraphs: [
      'This policy explains how Ritual retains, deletes, and manages user data across its applications, integrations, local software, backend systems, and supporting infrastructure.',
      'Ritual retains personal data only for as long as reasonably necessary to provide the service, support user-requested features, maintain security and reliability, comply with legal obligations, resolve disputes, and enforce agreements.',
    ],
  },
  {
    title: 'Retention Principles',
    bullets: [
      'Retain data only as long as reasonably necessary for the relevant feature or operational purpose.',
      'Minimize storage of high-sensitivity data where a less sensitive derived value will satisfy the product need.',
      'Stop future ingestion when a user disconnects an integration or revokes permissions.',
      'Honor verified deletion requests subject to technical, contractual, and legal limitations.',
    ],
  },
  {
    title: 'How Ritual Treats Different Data Types',
    bullets: [
      'Account and authentication data may be retained while an account remains active and for a reasonable period thereafter for security, integrity, and compliance purposes.',
      'Habit logs and user-created content may be retained until deleted by the user, deleted as part of an account deletion workflow, or no longer required for product operation.',
      'Health, wearable, and biometric data may be retained while the relevant feature remains active and for so long as needed to provide analytics, history, and user-requested functionality.',
      'Plaid connection metadata, normalized transaction data, and derived daily spending records may be retained for sync integrity, spending rollups, troubleshooting, history, and user-requested features.',
      'Desktop activity, screen-time, screenshot, OCR, and memory-related data may be stored locally on the user\'s device and, where enabled, may also be processed through Ritual cloud services.',
      'Operational logs and diagnostics may be retained for limited periods for debugging, abuse prevention, incident response, and service reliability.',
    ],
  },
  {
    title: 'Integration Disconnects',
    paragraphs: [
      'Disconnecting an integration generally revokes the connection\'s active status inside Ritual and stops future syncs from that provider.',
      'Disconnecting an integration does not necessarily delete historical data already imported into Ritual unless Ritual specifically performs a deletion workflow for that data or the user submits a verified deletion or account deletion request.',
    ],
  },
  {
    title: 'Account and Data Deletion',
    paragraphs: [
      'When Ritual processes a verified account or data deletion request, Ritual takes reasonable steps to delete or de-identify data from active systems, subject to legal obligations, fraud prevention, abuse prevention, backup and disaster recovery constraints, and technical limitations in third-party systems.',
      'Residual copies may persist temporarily in backups, logs, caches, or recovery systems until those systems cycle out the relevant data in the ordinary course.',
    ],
  },
  {
    title: 'Local Data and Configured Retention Windows',
    paragraphs: [
      'Some local recorder and memory features use product-configured cleanup behavior and retention windows. For example, certain local recorder configurations apply a default retention window for thumbnails and OCR-related data stored on the user\'s device.',
    ],
  },
  {
    title: 'Review and Enforcement',
    paragraphs: [
      'Ritual reviews this policy at least annually and when introducing material changes to its data architecture, vendors, deletion workflows, retention workflows, or legal obligations.',
      'Retention and deletion practices are enforced through a combination of application logic, local cleanup behavior, integration disconnect flows, operational procedures, and verified account or data deletion handling.',
    ],
  },
  {
    title: 'Contact',
    paragraphs: [
      'Questions or verified deletion requests relating to this policy may be submitted through Ritual\'s support or contact channels made available within the product or on Ritual\'s website.',
    ],
  },
]

export default function DataRetentionPage() {
  return (
    <main className="min-h-screen bg-white text-gray-900" style={{ fontFamily: "'FK Grotesk Neue', sans-serif" }}>
      <div className="mx-auto max-w-4xl px-6 py-16 sm:px-8 sm:py-20">
        <div className="mb-10 flex items-center justify-between gap-4">
          <Link
            href="/"
            className="text-sm text-gray-500 transition-colors hover:text-gray-900"
          >
            Ritual
          </Link>
          <Link
            href="/privacy"
            className="text-sm text-gray-500 transition-colors hover:text-gray-900"
          >
            Privacy policy
          </Link>
        </div>

        <header className="border-b border-gray-200 pb-8">
          <p className="mb-3 text-sm uppercase tracking-[0.18em] text-gray-500">Legal</p>
          <h1 className="text-4xl font-medium tracking-[-0.03em] text-gray-950 sm:text-5xl">
            Data Deletion and Retention Policy
          </h1>
          <div className="mt-5 space-y-1 text-sm text-gray-500">
            <p>Effective Date: March 18, 2026</p>
            <p>Company: Ritual</p>
          </div>
        </header>

        <div className="mt-10 space-y-10">
          {sections.map((section) => (
            <section key={section.title} className="border-b border-gray-100 pb-10 last:border-b-0">
              <h2 className="mb-4 text-2xl font-medium tracking-[-0.02em] text-gray-950">
                {section.title}
              </h2>
              {section.paragraphs?.map((paragraph) => (
                <p key={paragraph} className="mb-4 max-w-3xl text-base leading-8 text-gray-700 last:mb-0">
                  {paragraph}
                </p>
              ))}
              {section.bullets ? (
                <ul className="space-y-3 text-base leading-8 text-gray-700">
                  {section.bullets.map((bullet) => (
                    <li key={bullet} className="flex gap-3">
                      <span className="mt-[0.72rem] h-1.5 w-1.5 flex-none rounded-full bg-gray-900" />
                      <span>{bullet}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </section>
          ))}
        </div>
      </div>
    </main>
  )
}
