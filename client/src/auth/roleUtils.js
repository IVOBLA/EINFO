// Role utilities aligned with User_roles.json (objects) and legacy arrays.
export const EDIT_ROLES = ["LtStb", "S2", "Admin"];

/**
 * Return true if user may edit (LtStb, S2, Admin).
 * Accepts either a single `user.role` string or `user.roles` string[].
 */
export function canEdit(user) {
  if (!user) return false;
  const single = user.role && String(user.role);
  if (single && EDIT_ROLES.includes(single)) return true;
  const list = Array.isArray(user.roles) ? user.roles.map(String) : [];
  return list.some(r => EDIT_ROLES.includes(r));
}
