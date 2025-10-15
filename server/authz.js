export function requireRoleAny(...allowed) {
  return (req, res, next) => {
    const roles = req.user?.roles || [];
    if (!roles.some(r => allowed.includes(r))) {
      return res.status(403).json({ error: "forbidden" });
    }
    next();
  };
}
