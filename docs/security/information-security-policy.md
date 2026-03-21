# Ritual Information Security Policy

Version: 1.0  
Effective Date: 2026-03-18  
Owner: Nicholas Gardner, Founder, Ritual  
Review Frequency: At least annually and upon material architectural or vendor changes

## Purpose

Ritual maintains this Information Security Policy to identify, mitigate, and monitor information security risks relevant to the business, product, and user data processed by Ritual.

This policy applies to Ritual’s dashboard, backend APIs, desktop application, iOS companion application, supporting infrastructure, and third-party integrations.

## Security Principles

Ritual’s security program is guided by the following principles:

- protect the confidentiality of user data and integration credentials
- preserve the integrity of user records, sync pipelines, and analytics
- minimize the collection and retention of sensitive data
- restrict access to systems and data based on legitimate business need
- monitor systems for failures, broken credentials, and other security-relevant events
- respond to incidents promptly and document remediation actions

## Governance and Risk Management

Security oversight is owned by Nicholas Gardner, Founder of Ritual. Security responsibilities include maintaining this policy, reviewing material architecture or vendor changes, controlling production access, and coordinating incident response.

Ritual performs security review when:

- enabling a new high-sensitivity integration such as Plaid
- introducing new credential storage or sync flows
- making material changes to authentication, backend data handling, or third-party access
- responding to security incidents or identified vulnerabilities

## Access Control

Ritual limits access to production systems, operational tools, and user data to authorized persons with a legitimate business need.

Key requirements:

- production access is granted on a least-privilege basis
- secrets are stored outside source control
- access is removed when no longer required
- shared credentials are avoided where practical
- protected backend routes require authenticated bearer tokens

Ritual uses Clerk for end-user authentication, and backend APIs validate authentication tokens server-side before granting access to protected resources.

## Credential and Secret Protection

Ritual treats integration credentials, device secrets, and authentication tokens as sensitive data.

Security controls include:

- server-side handling of third-party credentials whenever possible
- encrypted storage of sensitive integration tokens in production using an application-managed encryption key
- separation of encryption keys from stored application data
- avoidance of storing plaintext secrets in code, logs, or documentation

For Plaid specifically, access tokens are intended to remain on the backend and are not intentionally exposed directly to browser or desktop clients.

## Data Minimization and Sensitive Data Handling

Ritual limits data collection and use to what is necessary to provide the product.

Examples:

- authentication data is used only for account access and session validation
- wearable and health data are used only for the sync and analytics functionality selected by the user
- Plaid-backed spending is scoped to generating daily spending totals for a user’s Ritual habit data rather than operating a broad transaction analysis product

Ritual avoids collecting, storing, or exposing more sensitive third-party data than is necessary for the intended feature.

## Secure Development and Change Management

Ritual incorporates security into development through code review, scoped releases, and validation of sensitive flows before deployment.

Changes affecting authentication, integration credentials, financial data, or backend authorization receive elevated scrutiny. Security-relevant issues are prioritized based on impact to user data, credentials, and service integrity.

## Infrastructure, Monitoring, and Resilience

Ritual uses managed infrastructure and application-level controls to reduce operational risk.

Current controls include:

- environment-specific configuration for development and production
- backend health checks for core services
- CORS restrictions for approved frontend origins
- API rate limiting
- logging of backend application errors and integration failures
- recovery procedures for local database replica corruption and broken third-party credentials

## Vendor and Third-Party Management

Ritual evaluates third-party providers based on product necessity, the sensitivity of data involved, and the provider’s role in authentication, infrastructure, analytics, or financial connectivity.

Ritual seeks to limit data shared with third parties to the minimum required for the relevant product function.

## Incident Response

Ritual maintains an incident response process for suspected or confirmed security events. Security incidents are handled through identification, containment, assessment, remediation, recovery, and post-incident review.

Where required by law or contract, Ritual will provide notice of confirmed incidents affecting user data.

## Review and Maintenance

This policy is reviewed at least annually and when Ritual introduces material changes to architecture, vendors, or sensitive data flows.

## Current Operationalization in Ritual

This policy is operationalized in Ritual’s current product and infrastructure in the following ways:

- Clerk-based user authentication with server-side JWT verification
- protected backend APIs that require authenticated bearer tokens
- encryption support for stored integration tokens via `TOKEN_ENCRYPTION_KEY`
- server-side Plaid token handling and reconnect flows
- rate limiting and CORS controls in the backend
- health checks and logging for backend services and sync failures
- platform keychain storage for iOS companion credentials

Internal implementation references:

- `apps/backend/services/auth_service.py`
- `apps/backend/services/token_crypto.py`
- `apps/backend/api/financial.py`
- `apps/backend/services/plaid_service.py`
- `apps/backend/main.py`
- `apps/ios-companion/Sources/RitualCompanion/Services/RitualAPIClient.swift`
