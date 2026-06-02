# Ritual Data Deletion and Retention Policy

## Purpose

This Data Deletion and Retention Policy explains how Ritual retains, deletes, and manages user data across its applications, integrations, local software, backend systems, and supporting infrastructure.

Ritual's goal is to retain personal data only for as long as reasonably necessary to provide the Services, support user-requested features, maintain security and service integrity, comply with legal obligations, resolve disputes, and enforce agreements.

## Scope

This policy applies to data processed by Ritual's:

- web and desktop applications
- backend APIs and hosted services
- iOS companion application
- local desktop tracking and recorder features
- connected health, wearable, and financial integrations
- analytics, monitoring, and support systems used to operate the Services

## Retention Principles

Ritual follows these retention principles:

- retain data only as long as reasonably necessary for the relevant feature or operational purpose
- minimize storage of high-sensitivity data where a less sensitive derived value will satisfy the product need
- separate active product data from short-lived operational and diagnostic data where practical
- stop future ingestion when a user disconnects an integration or revokes permissions
- honor verified deletion requests subject to technical, contractual, and legal limitations

## Data Categories and Retention Approach

### 1. Account and Authentication Data

Ritual retains account profile information, account identifiers, and authentication-related metadata while an account remains active and for a reasonable period thereafter as necessary to maintain account integrity, security, dispute resolution, and legal compliance.

### 2. Habit Logs and User-Created Content

Habit logs, categories, notes, and other user-created records are retained as part of a user's account data until deleted by the user, deleted as part of an account deletion workflow, or no longer required for product operation.

### 3. Health, Wearable, and Biometric Data

Health, wearable, and biometric data imported into Ritual is retained while the relevant feature remains active and for so long as needed to provide analytics, history, and user-requested product functionality, unless deleted as part of a supported deletion workflow or verified account deletion request.

If a provider is disconnected, Ritual will generally stop future syncs for that provider. Historical data already imported into Ritual may remain stored unless deleted through a supported deletion path or account deletion request.

### 4. Financial Data

If a user connects Plaid, Ritual may retain:

- connection and account metadata
- normalized transaction records required for spending rollups, sync integrity, deduplication, troubleshooting, and user history
- derived daily spending habit logs and related metadata

Ritual minimizes financial use by limiting the product purpose of Plaid data to spending-tracking features selected by the user. Disconnecting Plaid stops future syncs, but historical data already imported into Ritual may remain stored until deleted through a supported deletion path, data cleanup process, or verified account deletion request.

### 5. Desktop Activity, Screen Time, and Recorder Data

Desktop activity, screen-time, screenshot, OCR, and memory-related data may be stored locally on the user's device and, where enabled, may also be processed through Ritual cloud services.

Some local recorder and memory data is subject to product-configured retention windows. For example, certain local recorder configurations use a default retention period for thumbnails and OCR-related data. Local cleanup jobs may remove old data automatically based on configured retention settings.

### 6. Operational Logs, Diagnostics, and Security Records

Ritual retains logs, error records, operational metrics, and security-relevant records for limited periods as reasonably necessary for reliability, debugging, abuse prevention, incident response, and compliance.

## Data Deletion

### User-Initiated Deletion

Ritual may support user-initiated deletion through actions such as:

- deleting user-created content
- disconnecting integrations
- disabling local tracking features
- requesting deletion of account data or the account itself

Where a deletion request is made, Ritual may require sufficient information to verify the identity and authority of the requester before acting.

### Integration Disconnects

Disconnecting an integration generally:

- revokes the connection's active status within Ritual
- stops future syncs and ingestion from that provider

Disconnecting an integration does not necessarily delete historical data already imported into Ritual unless Ritual specifically performs a deletion workflow for that data or the user submits a verified deletion or account deletion request.

### Account Deletion

When Ritual processes a verified account deletion request, Ritual will take reasonable steps to delete or de-identify the user's account data from active systems, subject to:

- data required for legal compliance
- fraud prevention, abuse prevention, or security obligations
- backup, archival, or disaster recovery constraints
- technical limitations in third-party systems or processor environments

Residual copies may persist temporarily in backups, logs, caches, or disaster recovery systems until those systems cycle out the relevant data in the ordinary course.

## Enforcement and Review

Ritual reviews this policy at least annually and when introducing material changes to:

- data architecture
- new categories of sensitive information
- new vendors or integration flows
- deletion or retention workflows
- legal or regulatory obligations

Retention and deletion practices are enforced through a combination of application logic, local cleanup behavior, integration disconnect flows, operational procedures, and verified account or data deletion handling.

## Operationalization in Ritual

Examples of this policy being operationalized in Ritual include:

- local recorder retention settings for screenshots, thumbnails, and OCR-related data
- integration disconnect flows for Plaid and wearable providers
- backend deletion paths for certain biometric data categories
- retention-oriented cleanup jobs for selected memory and local-device data paths
- account-scoped application data storage and provider-scoped sync controls

Representative implementation references:

- `apps/backend/services/financial_connection_service.py`
- `apps/backend/api/financial.py`
- `apps/backend/services/biometrics_service.py`
- `apps/backend/services/memory_retention_service.py`
- `apps/desktop/src-tauri/src/watcher.rs`

## Contact

Questions or verified deletion requests relating to this policy may be submitted through Ritual's support or contact channels made available within the product or on Ritual's website.
