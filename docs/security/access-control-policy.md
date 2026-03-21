# Ritual Access Control Policy

Version: 1.0  
Effective Date: 2026-03-18  
Owner: Nicholas Gardner, Founder, Ritual  
Review Frequency: At least annually and when access models materially change

## Purpose

This Access Control Policy defines how Ritual manages access to production systems, operational tooling, source code, user data, and sensitive credentials.

## Principle

Ritual grants access based on least privilege and legitimate business need. Access is limited to the minimum required to perform a role or task.

## Scope

This policy applies to:

- production infrastructure and hosted services
- backend administration and operational tooling
- source code repositories
- databases and analytics systems
- authentication, integration, and encryption secrets
- user data and support access

## Access Requirements

Ritual requires that:

- access be granted only to authorized individuals
- production access be limited to those who need it for engineering, operations, or support
- secrets not be stored in source control
- unique credentials be used where practical
- access be revoked when it is no longer needed

## Sensitive Systems and Data

Higher-sensitivity systems include:

- authentication systems
- production databases
- encryption keys
- integration credential stores
- financial and health-related data flows

Access to these systems is more tightly restricted than general development access.

## End-User Access Control

Ritual uses Clerk for end-user authentication. Backend APIs validate authenticated bearer tokens before permitting access to protected user resources.

Users may access only data associated with their authenticated account, subject to backend authorization checks.

## Administrative Access Control

Administrative access is limited to authorized operators. When administrative or production access is granted, Ritual expects:

- use of secure authentication methods
- access only for legitimate operational tasks
- prompt removal of access when responsibilities change
- avoidance of unnecessary access to raw user data

## Secret and Token Handling

Sensitive secrets, including third-party integration tokens and encryption keys, must be handled securely.

Requirements:

- secrets must be stored outside source control
- sensitive integration tokens must be encrypted at rest in production
- encryption keys must be managed separately from stored encrypted data
- secrets must not be intentionally exposed in logs or shared in plaintext outside approved operational use

## Review and Revocation

Access is reviewed when responsibilities change and revoked when it is no longer necessary. Any suspected misuse of access is treated as a security matter and escalated under Ritual’s Incident Response Plan.
