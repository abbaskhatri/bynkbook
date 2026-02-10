import { apiFetch } from "@/lib/api/client";

export type TeamMember = {
  user_id: string;
  email?: string | null;
  role: string;
  created_at: string;
};

export type TeamInvite = {
  id: string;
  email: string;
  role: string;
  token?: string;
  expires_at: string;
  created_at: string;
};

export async function getTeam(businessId: string): Promise<{ members: TeamMember[]; invites: TeamInvite[] }> {
  const res: any = await apiFetch(`/v1/businesses/${businessId}/team`);
  return { members: res?.members ?? [], invites: res?.invites ?? [] };
}

export async function createInvite(businessId: string, email: string, role: string): Promise<TeamInvite> {
  const res: any = await apiFetch(`/v1/businesses/${businessId}/team/invites`, {
    method: "POST",
    body: JSON.stringify({ email, role }),
  });
  return res?.invite;
}

export async function revokeInvite(businessId: string, inviteId: string): Promise<any> {
  return apiFetch(`/v1/businesses/${businessId}/team/invites/${inviteId}/revoke`, { method: "POST" });
}

export async function acceptInvite(token: string): Promise<any> {
  return apiFetch(`/v1/team/invites/accept`, {
    method: "POST",
    body: JSON.stringify({ token }),
  });
}

export async function updateMemberRole(businessId: string, userId: string, role: string): Promise<any> {
  return apiFetch(`/v1/businesses/${businessId}/team/members/${userId}`, {
    method: "PATCH",
    body: JSON.stringify({ role }),
  });
}

export async function removeMember(businessId: string, userId: string): Promise<any> {
  return apiFetch(`/v1/businesses/${businessId}/team/members/${userId}`, { method: "DELETE" });
}
