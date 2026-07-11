const ROLE_NAV_VISIBILITY: Record<string, readonly string[]> = {
  "/planning": ["OWNER", "ADMIN", "BOOKKEEPER", "ACCOUNTANT"],
};

export function isNavigationPathVisible(path: string, role?: string | null): boolean {
  const allowedRoles = ROLE_NAV_VISIBILITY[path];
  if (!allowedRoles) return true;
  return allowedRoles.includes(String(role ?? "MEMBER").toUpperCase());
}
