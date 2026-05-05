import { afterEach, describe, expect, test, vi } from "vitest";

function event(body: any, sub = "actor", email = "member@example.com") {
  return {
    body: JSON.stringify(body),
    pathParameters: {},
    requestContext: {
      authorizer: { jwt: { claims: { sub, email } } },
      http: { method: "POST", path: "/v1/team/invites/accept" },
    },
  };
}

function futureDate() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d;
}

function pastDate() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d;
}

async function loadAcceptHandler(args?: {
  invite?: any;
  existingMember?: any;
}) {
  vi.resetModules();

  const invite = args?.invite ?? {
    id: "invite-1",
    business_id: "biz-1",
    email: "member@example.com",
    role: "BOOKKEEPER",
    token: "token-1",
    revoked_at: null,
    accepted_at: null,
    expires_at: futureDate(),
  };

  const existingMember = args?.existingMember ?? null;
  const logActivity = vi.fn(async () => undefined);
  const authorizeWrite = vi.fn(async () => ({ allowed: true }));

  const prisma = {
    businessInvite: {
      findFirst: vi.fn(async () => invite),
      update: vi.fn(async () => ({})),
    },
    userBusinessRole: {
      findFirst: vi.fn(async () => existingMember),
      create: vi.fn(async () => ({})),
    },
  };

  vi.doMock("./lib/db", () => ({
    getPrisma: vi.fn(async () => prisma),
  }));
  vi.doMock("./lib/activityLog", () => ({
    logActivity,
  }));
  vi.doMock("./lib/authz", () => ({
    authorizeWrite,
  }));

  const mod = await import("./team");
  return { handler: mod.handler, prisma, logActivity, authorizeWrite };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("team invite acceptance guards", () => {
  test("matching authenticated email can accept invite", async () => {
    const { handler, prisma } = await loadAcceptHandler();

    const res = await handler(event({ token: "token-1" }, "actor", "Member@Example.com"));

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toMatchObject({
      ok: true,
      status: "accepted",
      businessId: "biz-1",
      role: "BOOKKEEPER",
    });
    expect(prisma.userBusinessRole.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        business_id: "biz-1",
        user_id: "actor",
        email: "member@example.com",
        role: "BOOKKEEPER",
      }),
    });
  });

  test("wrong authenticated email cannot accept invite", async () => {
    const { handler, prisma, authorizeWrite } = await loadAcceptHandler();

    const res = await handler(event({ token: "token-1" }, "actor", "other@example.com"));

    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body)).toMatchObject({
      code: "INVITE_EMAIL_MISMATCH",
    });
    expect(authorizeWrite).not.toHaveBeenCalled();
    expect(prisma.userBusinessRole.create).not.toHaveBeenCalled();
    expect(prisma.businessInvite.update).not.toHaveBeenCalled();
  });

  test("active invite requires an authenticated email claim", async () => {
    const { handler, prisma, authorizeWrite } = await loadAcceptHandler();

    const res = await handler(event({ token: "token-1" }, "actor", ""));

    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body)).toMatchObject({
      code: "INVITE_EMAIL_CLAIM_REQUIRED",
    });
    expect(authorizeWrite).not.toHaveBeenCalled();
    expect(prisma.userBusinessRole.create).not.toHaveBeenCalled();
    expect(prisma.businessInvite.update).not.toHaveBeenCalled();
  });

  test("revoked invite remains blocked before email acceptance", async () => {
    const { handler, prisma } = await loadAcceptHandler({
      invite: {
        id: "invite-1",
        business_id: "biz-1",
        email: "member@example.com",
        role: "MEMBER",
        revoked_at: new Date(),
        accepted_at: null,
        expires_at: futureDate(),
      },
    });

    const res = await handler(event({ token: "token-1" }));

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toBe("Invite revoked");
    expect(prisma.userBusinessRole.create).not.toHaveBeenCalled();
  });

  test("expired invite remains blocked", async () => {
    const { handler, prisma } = await loadAcceptHandler({
      invite: {
        id: "invite-1",
        business_id: "biz-1",
        email: "member@example.com",
        role: "MEMBER",
        revoked_at: null,
        accepted_at: null,
        expires_at: pastDate(),
      },
    });

    const res = await handler(event({ token: "token-1" }));

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toBe("Invite expired");
    expect(prisma.userBusinessRole.create).not.toHaveBeenCalled();
  });

  test("accepted invite remains idempotent", async () => {
    const { handler, prisma, authorizeWrite } = await loadAcceptHandler({
      invite: {
        id: "invite-1",
        business_id: "biz-1",
        email: "member@example.com",
        role: "MEMBER",
        revoked_at: null,
        accepted_at: new Date(),
        expires_at: futureDate(),
      },
    });

    const res = await handler(event({ token: "token-1" }, "actor", "other@example.com"));

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toMatchObject({
      status: "already_accepted",
      businessId: "biz-1",
    });
    expect(authorizeWrite).not.toHaveBeenCalled();
    expect(prisma.userBusinessRole.create).not.toHaveBeenCalled();
  });

  test("existing member acceptance does not upgrade role", async () => {
    const { handler, prisma } = await loadAcceptHandler({
      existingMember: { id: "role-1", role: "MEMBER" },
    });

    const res = await handler(event({ token: "token-1" }, "actor", "member@example.com"));

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toMatchObject({
      status: "already_member",
      role: "MEMBER",
    });
    expect(prisma.userBusinessRole.create).not.toHaveBeenCalled();
    expect(prisma.businessInvite.update).toHaveBeenCalledWith({
      where: { id: "invite-1" },
      data: expect.objectContaining({
        accepted_by_user_id: "actor",
      }),
    });
  });
});
