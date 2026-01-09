# Bynkbook Project Constitution (v1.1) — Authoritative Contract

This document is the binding governance contract for building, operating, and evolving Bynkbook.
It is authoritative for all contributors and automation. If any request conflicts with this Constitution,
the request must be revised.

Status: APPROVED + LOCKED (v1.1)

Note: Phase 3 UI work MUST follow this Constitution strictly. Any deviation must be explicitly justified
in the PR description (or commit message in Manual GitOps Mode) with risk and follow-up plan.

---

## 0) Purpose
Bynkbook will be built and operated with PR-based GitOps discipline, measurable performance standards,
strict data-scoping guarantees, and durable memory. The product must remain organized, clean,
standardized, and instant-fast by design.

## 1) Scope
Applies to all Bynkbook repos, environments, contributors, agents, data pipelines, integrations,
and AI/memory subsystems.

## 2) Non-Negotiables
### 2.1 PR-Only Change Management
All changes are PR-based. No direct commits to protected branches. Every PR must have checks + preview deploy.

### 2.2 No Direct Edits to Production
Production changes only via approved merge + controlled deploy workflow. Agents have no prod credentials.

### 2.3 “Instant-Fast” Is a Product Feature
Bynkbook must feel immediate and responsive by design.

### 2.4 Durable Memory Is Mandatory
DynamoDB is the authoritative memory store. Vector search is optional augmentation only.

## 3) Core Principles
Correctness first, then speed, then convenience. Small reviewable changes. Standardization. Explicit contracts.
Observability required. Security and privacy are design constraints.

## 4) Definitions
- Business: top-level tenant boundary.
- Account: financial account within a Business.
- Instant-fast: visible feedback in <100ms; non-instant work shows progress and never blocks UI.
- Optimistic UI: immediate local mutation with rollback/reconcile to server truth.

## 6) GitOps Operating Rules (Summary)
Protected branches enforce PR + required checks + reviews. One PR = one objective. Risky changes split in two.

## 7) Environments and Deployment (Summary)
Preview deploy required for every PR. Production deploy gated by protected merge + release controls + rollback readiness.

## 8) Performance Constitution (Measurable Standards)
### 8.1 UI responsiveness
Any user action must show visible feedback in <100ms.

### 8.2 Optimistic UI for mutations (clarified)
Optimistic UI is required by default for create/update/delete mutations, with rollback or reconciliation.

### 8.4 Render-time complexity (explicit prohibition)
Render-time O(n) work is forbidden when it scales with dataset size (including sorting, filtering, issue detection,
or running balance recomputation at render). Non-trivial compute must be moved out of render paths.

## 10) API and Data Contract Standards
### 10.3 Business + Account scoping rules (mandatory)
All reads/writes/jobs/caches/UI state must be scope-aware by businessId and accountId. No cross-scope reuse.

## 11) Ledger Behavioral Contract (mandatory)
Deterministic sorting: entryDate desc, then createdAt desc, then deterministic tie-breaker.
Running balance correctness without render-time O(n) recomputation.
Opening balance is first-class and non-duplicative.
Issues update immediately with optimistic + reconcile; scan async with progress.
Ledger mutations (create/update/delete/merge) must feel instant and reconcile to server truth.

---

This file exists to anchor the approved Constitution v1.1 inside the repository for governance and onboarding.
