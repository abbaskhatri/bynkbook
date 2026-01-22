import { getPrisma } from "./lib/db";
import { logActivity } from "./lib/activityLog";
import { randomBytes } from "node:crypto";

function json(statusCode: number, body: any) {
  return {
    statusCode,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

function getClaims(event: any) {
  const auth = event?.requestContext?.authorizer ?? {};
  return auth?.jwt?.claims ?? auth?.claims ?? {};
}

function pp(event: any) {
  return event?.pathParameters ?? {};
}

function getPath(event: any) {
  return String(event?.requestContext?.http?.path ?? "");
}

function normalizeEmail(input: string) {
  return String(input ?? "").trim().toLowerCase();
}

const ROLE_ALLOWLIST = new Set(["OWNER", "ADMIN", "BOOKKEEPER", "ACCOUNTANT", "MEMBER"]);
function normalizeRole(input: string) {
  const role = String(input ?? "").trim().toUpperCase();
  if (!ROLE_ALLOWLIST.has(role)) return null;
  return role;
}

const WRITE_ROLES = new Set(["OWNER", "ADMIN", "BOOKKEEPER", "ACCOUNTANT"]);
function canWrite(role: string | null | undefined) {
  return !!role && WRITE_ROLES.has(String(role).toUpperCase());
}
function isOwner(role: string | null | undefined) {
  return String(role ?? "").toUpperCase() === "OWNER";
}

async function getMyRole(prisma: any, businessId: string, userId: string) {
  const row = await prisma.userBusinessRole.findFirst({
    where: { business_id: businessId, user_id: userId },
    select: { role: true },
  });
  return row?.role ?? null;
}

async function requireMembership(prisma: any, businessId: string, userId: string) {
  const role = await getMyRole(prisma, businessId, userId);
  if (!role) return null;
  return role;
}

async function countOwners(prisma: any, businessId: string) {
  return prisma.userBusinessRole.count({
    where: { business_id: businessId, role: "OWNER" },
  });
}

function inviteExpiresAt7dIso() {
  const d = new Date();
  d.setDate(d.getDate() + 7);
  return d.toISOString();
}

function buildToken() {
  return randomBytes(24).toString("hex"); // 48 chars
}

export async function handler(event: any) {
  const method = event?.requestContext?.http?.method ?? "GET";
  const path = getPath(event);

  const claims = getClaims(event);
  const sub = claims.sub as string | undefined;
  if (!sub) return json(401, { ok: false, error: "Unauthorized" });

  const prisma = await getPrisma();

  // -------- Accept invite (no businessId in path) --------
  if (method === "POST" && path === "/v1/team/invites/accept") {
    let body: any = {};
    try {
      body = event?.body ? JSON.parse(event.body) : {};
    } catch {
      return json(400, { ok: false, error: "Invalid JSON body" });
    }

    const token = String(body?.token ?? "").trim();
    if (!token) return json(400, { ok: false, error: "token is required" });

    const invite = await prisma.businessInvite.findFirst({
      where: { token },
    });

    if (!invite) return json(404, { ok: false, error: "Invite not found" });
    if (invite.revoked_at) return json(400, { ok: false, error: "Invite revoked" });
    if (invite.accepted_at) return json(200, { ok: true, status: "already_accepted", businessId: invite.business_id });

    const now = new Date();
    if (invite.expires_at && new Date(invite.expires_at).getTime() < now.getTime()) {
      return json(400, { ok: false, error: "Invite expired" });
    }

    // If already a business member, do NOT change their role via invite.
    const existing = await prisma.userBusinessRole.findFirst({
      where: { business_id: invite.business_id, user_id: sub },
      select: { id: true, role: true },
    });

    if (existing) {
      // Mark invite accepted, but keep member role unchanged
      await prisma.businessInvite.update({
        where: { id: invite.id },
        data: { accepted_at: now, accepted_by_user_id: sub },
      });

      await logActivity(prisma, {
        businessId: invite.business_id,
        actorUserId: sub,
        eventType: "TEAM_INVITE_ACCEPTED",
        payloadJson: { invite_id: invite.id, email: invite.email, status: "already_member" },
      });

      return json(200, {
        ok: true,
        status: "already_member",
        businessId: invite.business_id,
        role: existing.role,
      });
    }

    // Create membership with invite role (validated at creation time)
    await prisma.userBusinessRole.create({
      data: {
        id: undefined, // DB-generated if configured; if not, prisma will require. Your schema uses @db.Uuid without default on this model.
        business_id: invite.business_id,
        user_id: sub,
        role: invite.role,
      },
    });

    await prisma.businessInvite.update({
      where: { id: invite.id },
      data: { accepted_at: now, accepted_by_user_id: sub },
    });

    await logActivity(prisma, {
      businessId: invite.business_id,
      actorUserId: sub,
      eventType: "TEAM_INVITE_ACCEPTED",
      payloadJson: { invite_id: invite.id, email: invite.email, status: "accepted", role: invite.role },
    });

    return json(200, { ok: true, status: "accepted", businessId: invite.business_id, role: invite.role });
  }

  // -------- Business-scoped routes --------
  const { businessId = "", inviteId = "", userId = "" } = pp(event);
  const biz = String(businessId ?? "").trim();
  if (!biz) return json(400, { ok: false, error: "Missing businessId" });

  const myRole = await requireMembership(prisma, biz, sub);
  if (!myRole) return json(403, { ok: false, error: "Forbidden (not a member of this business)" });

  // GET /v1/businesses/{businessId}/team
  if (method === "GET" && path === `/v1/businesses/${biz}/team`) {
    const members = await prisma.userBusinessRole.findMany({
      where: { business_id: biz },
      orderBy: [{ created_at: "asc" }],
      select: { user_id: true, role: true, created_at: true },
    });

    const now = new Date();
    const invites = await prisma.businessInvite.findMany({
      where: {
        business_id: biz,
        revoked_at: null,
        accepted_at: null,
        expires_at: { gt: now },
      },
      orderBy: [{ created_at: "desc" }],
      select: { id: true, email: true, role: true, created_at: true, expires_at: true },
    });

    return json(200, { ok: true, members, invites });
  }

  // POST /v1/businesses/{businessId}/team/invites
  if (method === "POST" && path === `/v1/businesses/${biz}/team/invites`) {
    if (!canWrite(myRole)) return json(403, { ok: false, error: "Insufficient permissions" });

    let body: any = {};
    try {
      body = event?.body ? JSON.parse(event.body) : {};
    } catch {
      return json(400, { ok: false, error: "Invalid JSON body" });
    }

    const email = normalizeEmail(body?.email ?? "");
    const role = normalizeRole(body?.role ?? "");
    if (!email) return json(400, { ok: false, error: "email is required" });
    if (!role) return json(400, { ok: false, error: "Invalid role" });

    // Only OWNER can create OWNER invites
    if (role === "OWNER" && !isOwner(myRole)) return json(403, { ok: false, error: "Only OWNER can invite OWNER" });

    // Prevent duplicate active invite per email (code-level)
    const now = new Date();
    const existing = await prisma.businessInvite.findFirst({
      where: {
        business_id: biz,
        email,
        revoked_at: null,
        accepted_at: null,
        expires_at: { gt: now },
      },
      select: { id: true, token: true, expires_at: true, created_at: true },
    });

    if (existing) {
      return json(409, {
        ok: false,
        error: "Invite already exists",
        invite: { id: existing.id, token: existing.token, expires_at: existing.expires_at, created_at: existing.created_at },
      });
    }

    const token = buildToken();
    const expiresAt = inviteExpiresAt7dIso();

    const created = await prisma.businessInvite.create({
      data: {
        business_id: biz,
        email,
        role,
        token,
        created_by_user_id: sub,
        expires_at: new Date(expiresAt),
      },
      select: { id: true, email: true, role: true, token: true, expires_at: true, created_at: true },
    });

    await logActivity(prisma, {
      businessId: biz,
      actorUserId: sub,
      eventType: "TEAM_INVITE_CREATED",
      payloadJson: { invite_id: created.id, email: created.email, role: created.role, expires_at: created.expires_at },
    });

    // Backend returns token/inviteId/expiresAt (frontend builds full URL using window.location.origin)
    return json(201, { ok: true, invite: created });
  }

  // POST /v1/businesses/{businessId}/team/invites/{inviteId}/revoke (idempotent)
  if (method === "POST" && path === `/v1/businesses/${biz}/team/invites/${inviteId}/revoke`) {
    if (!canWrite(myRole)) return json(403, { ok: false, error: "Insufficient permissions" });

    const id = String(inviteId ?? "").trim();
    if (!id) return json(400, { ok: false, error: "Missing inviteId" });

    const row = await prisma.businessInvite.findFirst({
      where: { id, business_id: biz },
    });

    if (!row) return json(404, { ok: false, error: "Invite not found" });

    // Idempotent: if already revoked or accepted, return ok
    if (row.revoked_at) return json(200, { ok: true, status: "already_revoked" });
    if (row.accepted_at) return json(200, { ok: true, status: "already_accepted" });

    await prisma.businessInvite.update({
      where: { id },
      data: { revoked_at: new Date(), revoked_by_user_id: sub },
    });

    await logActivity(prisma, {
      businessId: biz,
      actorUserId: sub,
      eventType: "TEAM_INVITE_REVOKED",
      payloadJson: { invite_id: id, email: row.email },
    });

    return json(200, { ok: true, status: "revoked" });
  }

  // PATCH /v1/businesses/{businessId}/team/members/{userId}
  if (method === "PATCH" && path === `/v1/businesses/${biz}/team/members/${userId}`) {
    if (!canWrite(myRole)) return json(403, { ok: false, error: "Insufficient permissions" });

    let body: any = {};
    try {
      body = event?.body ? JSON.parse(event.body) : {};
    } catch {
      return json(400, { ok: false, error: "Invalid JSON body" });
    }

    const targetUserId = String(userId ?? "").trim();
    const newRole = normalizeRole(body?.role ?? "");
    if (!targetUserId) return json(400, { ok: false, error: "Missing userId" });
    if (!newRole) return json(400, { ok: false, error: "Invalid role" });

    // OWNER-only promotions to OWNER
    if (newRole === "OWNER" && !isOwner(myRole)) return json(403, { ok: false, error: "Only OWNER can promote to OWNER" });

    const target = await prisma.userBusinessRole.findFirst({
      where: { business_id: biz, user_id: targetUserId },
      select: { id: true, role: true },
    });
    if (!target) return json(404, { ok: false, error: "Member not found" });

    const targetIsOwner = String(target.role).toUpperCase() === "OWNER";

    // Only OWNER can modify an OWNER
    if (targetIsOwner && !isOwner(myRole)) return json(403, { ok: false, error: "Only OWNER can change an OWNER" });

    // Prevent downgrading last OWNER
    if (targetIsOwner && newRole !== "OWNER") {
      const owners = await countOwners(prisma, biz);
      if (owners <= 1) return json(409, { ok: false, error: "Cannot downgrade the last OWNER" });
    }

    await prisma.userBusinessRole.update({
      where: { id: target.id },
      data: { role: newRole },
    });

    await logActivity(prisma, {
      businessId: biz,
      actorUserId: sub,
      eventType: "TEAM_ROLE_CHANGED",
      payloadJson: { target_user_id: targetUserId, from_role: target.role, to_role: newRole },
    });

    return json(200, { ok: true });
  }

  // DELETE /v1/businesses/{businessId}/team/members/{userId}
  if (method === "DELETE" && path === `/v1/businesses/${biz}/team/members/${userId}`) {
    if (!canWrite(myRole)) return json(403, { ok: false, error: "Insufficient permissions" });

    const targetUserId = String(userId ?? "").trim();
    if (!targetUserId) return json(400, { ok: false, error: "Missing userId" });

    const target = await prisma.userBusinessRole.findFirst({
      where: { business_id: biz, user_id: targetUserId },
      select: { id: true, role: true },
    });
    if (!target) return json(404, { ok: false, error: "Member not found" });

    const targetIsOwner = String(target.role).toUpperCase() === "OWNER";

    // Only OWNER can remove an OWNER
    if (targetIsOwner && !isOwner(myRole)) return json(403, { ok: false, error: "Only OWNER can remove an OWNER" });

    // Prevent removing last OWNER
    if (targetIsOwner) {
      const owners = await countOwners(prisma, biz);
      if (owners <= 1) return json(409, { ok: false, error: "Cannot remove the last OWNER" });
    }

    await prisma.userBusinessRole.delete({ where: { id: target.id } });

    await logActivity(prisma, {
      businessId: biz,
      actorUserId: sub,
      eventType: "TEAM_MEMBER_REMOVED",
      payloadJson: { target_user_id: targetUserId, target_role: target.role },
    });

    return json(200, { ok: true });
  }

  return json(404, { ok: false, error: "Not found" });
}
