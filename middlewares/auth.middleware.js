const { verifyAccessToken } = require("../services/token.service");

function authenticateAccessToken(req, res, next) {
  try {
    const authorization = req.get("authorization") || "";
    const [scheme, token] = authorization.split(" ");

    if (scheme !== "Bearer" || !token) {
      return res.status(401).json({ message: "Access token is required" });
    }

    req.auth = verifyAccessToken(token);
    next();
  } catch (err) {
    return res.status(401).json({ message: err.message });
  }
}

function requireAdminRole(...roles) {
  return (req, res, next) => {
    if (req.auth?.subject_type !== "ADMIN") {
      return res.status(403).json({ message: "Admin access is required" });
    }

    if (roles.length && !roles.includes(req.auth.role)) {
      return res.status(403).json({ message: "Admin role is not allowed" });
    }

    next();
  };
}

module.exports = {
  authenticateAccessToken,
  requireAdminRole,
};
