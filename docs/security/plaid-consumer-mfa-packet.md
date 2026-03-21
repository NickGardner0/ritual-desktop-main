# Ritual Consumer MFA Documentation

Company: Ritual  
Prepared by: Nicholas Gardner, Founder  
Effective Date: 2026-03-18  
Document Version: 1.0

---

## Overview

This document describes Ritual’s consumer multi-factor authentication implementation for web and mobile access, and the additional product-side control used before financial connectivity is surfaced.

Ritual uses Clerk for consumer authentication and requires multi-factor authentication for user accounts. For higher-sensitivity bank connectivity features, Ritual also applies an application-level control that prevents the Plaid connection flow from being surfaced unless the authenticated user account has MFA enabled.

## MFA Methods Enabled

Ritual’s current consumer MFA configuration in Clerk includes:

- SMS verification code
- authenticator application
- backup codes
- required MFA enforcement for consumer accounts

These controls support a truthful vendor questionnaire response of:

`Yes - Non-phishing-resistant multi-factor authentication is performed`

Ritual does not represent this implementation as phishing-resistant MFA unless and until a qualifying phishing-resistant control is specifically enforced before Plaid Link is surfaced.

## Product-Side Enforcement Before Plaid Link

In addition to Clerk-level MFA enforcement, Ritual applies a product-side control within the Plaid / Spending integration flow:

- the user must be authenticated with Ritual through Clerk
- the application checks whether the authenticated account has MFA enabled
- if MFA is not enabled, the application does not surface the Plaid connection flow
- instead, the user is directed to account security settings to complete MFA setup first

This creates an additional control at the application level for financial connectivity.

## User Experience

If a user has not enabled MFA:

- the Plaid / Spending integration shows that MFA is required
- the details panel explains that MFA must be enabled before bank connection is available
- the user is directed to account security settings to complete MFA setup

If a user has enabled MFA:

- the user can proceed to the Plaid connection flow

## Operational Implementation

Ritual’s current implementation includes:

- Clerk-authenticated consumer sessions
- server-side JWT validation in the Ritual backend
- MFA required in Clerk configuration
- product-side gating in the Plaid / Spending integration before bank connection

Representative implementation references:

- `apps/dashboard/app/(dashboard)/integrations/integrations-client.tsx`
- `apps/dashboard/components/settings-modal.tsx`
- `apps/backend/services/auth_service.py`
- `apps/backend/api/financial.py`

## Supporting Evidence

Recommended supporting uploads for this control:

- screenshot of Clerk MFA settings showing enabled MFA methods and required MFA enforcement
- screenshot of Ritual’s Plaid / Spending integration reflecting the MFA requirement before connection

## Approval

Prepared by: Nicholas Gardner  
Title: Founder  
Company: Ritual  
Date: 2026-03-18
