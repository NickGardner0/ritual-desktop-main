# Ritual Infrastructure and Data Protection Controls

Company: Ritual  
Prepared by: Nicholas Gardner, Founder  
Effective Date: 2026-03-18  
Document Version: 1.0

---

## Overview

This document summarizes Ritual’s controls relevant to:

- multi-factor authentication for access to critical systems that store or process consumer financial data
- encryption in transit between clients and servers
- encryption at rest for consumer financial data received from Plaid

## 5. MFA for Critical Systems

Ritual requires multi-factor authentication for access to critical administrative systems that store, process, or control access to consumer financial data and supporting infrastructure.

Critical systems include, as applicable:

- Plaid Dashboard
- Clerk
- database and infrastructure administration
- hosting and deployment systems
- analytics and operational systems with access to production data
- source control and secrets management systems used to administer production

Ritual’s access control model is based on least privilege and limits production access to authorized operators with a legitimate business need.

## 6. Encryption in Transit

Ritual uses encrypted transport for production communications between clients and servers.

Current implementation details include:

- production frontend and backend endpoints are intended to be served over HTTPS
- backend-to-database sync for Turso embedded replica mode uses HTTPS sync URLs
- external service integrations are performed over vendor HTTPS endpoints

Ritual’s production expectation is TLS 1.2 or better for client-server communication.

## 7. Encryption at Rest for Plaid Data

Ritual applies encryption controls to sensitive financial integration data received from Plaid.

Current controls include:

- Plaid access tokens and sensitive integration tokens are encrypted in application storage using `TOKEN_ENCRYPTION_KEY`
- the embedded Turso local replica now supports encryption at rest through `TURSO_LOCAL_ENCRYPTION_KEY`
- production operation is expected to enable both controls

For Ritual’s Plaid-backed spending implementation, the system is intentionally scoped toward deriving daily spending totals rather than exposing a general-purpose transaction ledger.

## Operational Implementation References

- `apps/backend/services/token_crypto.py`
- `apps/backend/database/connection.py`
- `apps/backend/services/plaid_service.py`
- `apps/backend/api/financial.py`
- `apps/backend/.env.example`
- `docs/release_checklist.md`

## Recommended Production Configuration

Ritual’s production environment should include:

- `TOKEN_ENCRYPTION_KEY`
- `TURSO_LOCAL_ENCRYPTION_KEY`
- `PLAID_ENV=production`
- `PLAID_CLIENT_ID`
- `PLAID_SECRET`
- `PLAID_REDIRECT_URI`
- `PLAID_WEBHOOK_URL`

## Approval

Prepared by: Nicholas Gardner  
Title: Founder  
Company: Ritual  
Date: 2026-03-18
