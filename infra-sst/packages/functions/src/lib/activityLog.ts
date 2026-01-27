export type ActivityEventType =
  | "AUTHZ_SOFT_EVALUATED"
  | "AUTHZ_ENFORCED_DENIED"
  | "AUTHZ_ENFORCED_SKIPPED"
  | "TEAM_INVITE_CREATED"
  | "TEAM_INVITE_REVOKED"
  | "TEAM_INVITE_ACCEPTED"
  | "TEAM_ROLE_CHANGED"
  | "TEAM_MEMBER_REMOVED"
  | "ROLE_POLICY_UPDATED"
  | "RECONCILE_MATCH_CREATED"
  | "RECONCILE_MATCH_VOIDED"
  | "RECONCILE_ENTRY_ADJUSTMENT_MARKED"
  | "RECONCILE_ENTRY_ADJUSTMENT_UNMARKED"
  | "RECONCILE_SNAPSHOT_CREATED"
  | "CLOSED_PERIOD_CLOSED"
  | "CLOSED_PERIOD_REOPENED";

export async function logActivity(prisma: any, args: {
  businessId: string;
  actorUserId: string;
  eventType: ActivityEventType;
  payloadJson: any;
  scopeAccountId?: string | null;
}) {
  // Best-effort; never block the main action if logging fails.
  try {
    await prisma.activityLog.create({
      data: {
        business_id: args.businessId,
        scope_account_id: args.scopeAccountId ?? null,
        event_type: args.eventType,
        actor_user_id: args.actorUserId,
        payload_json: args.payloadJson ?? {},
      },
    });
  } catch {
    // swallow
  }
}
