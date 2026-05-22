const crypto = require("crypto");
const RefreshToken = require("../models/refreshToken.model");

const subjectConfig = {
  USER: {
    modelName: "User",
    publicIdField: "user_id",
    accessTokenSeconds: 60 * 60,
    refreshTokenSeconds: 60 * 60 * 24 * 90,
  },
  RIDER: {
    modelName: "Rider",
    publicIdField: "rider_id",
    accessTokenSeconds: 60 * 60,
    refreshTokenSeconds: 60 * 60 * 24 * 90,
  },
  BUSINESS: {
    modelName: "Business",
    publicIdField: "business_id",
    accessTokenSeconds: 60 * 30,
    refreshTokenSeconds: 60 * 60 * 24 * 30,
  },
  ADMIN: {
    modelName: "Admin",
    publicIdField: "admin_id",
    accessTokenSeconds: 60 * 20,
    refreshTokenSeconds: 60 * 60 * 24,
  },
};

function base64UrlEncode(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function base64UrlDecode(value) {
  return JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
}

function signToken(unsignedToken) {
  return crypto
    .createHmac(
      "sha256",
      process.env.ACCESS_TOKEN_SECRET || process.env.JWT_SECRET || "dev-access-secret",
    )
    .update(unsignedToken)
    .digest("base64url");
}

function createAccessToken(subjectType, principal) {
  const config = subjectConfig[subjectType];
  const issuedAt = Math.floor(Date.now() / 1000);
  const expiresAt = issuedAt + config.accessTokenSeconds;

  const header = base64UrlEncode({ alg: "HS256", typ: "JWT" });
  const payload = base64UrlEncode({
    sub: String(principal._id),
    subject_type: subjectType,
    public_id: principal[config.publicIdField],
    role: principal.role || principal.account_type,
    iat: issuedAt,
    exp: expiresAt,
  });
  const unsignedToken = `${header}.${payload}`;

  return {
    token: `${unsignedToken}.${signToken(unsignedToken)}`,
    expires_in: config.accessTokenSeconds,
    expires_at: new Date(expiresAt * 1000),
  };
}

function verifyAccessToken(token) {
  const [header, payload, signature] = token.split(".");

  if (!header || !payload || !signature) {
    throw new Error("Malformed access token");
  }

  const unsignedToken = `${header}.${payload}`;
  const expectedSignature = signToken(unsignedToken);

  const received = Buffer.from(signature);
  const expected = Buffer.from(expectedSignature);

  if (received.length !== expected.length || !crypto.timingSafeEqual(received, expected)) {
    throw new Error("Invalid access token signature");
  }

  const decodedPayload = base64UrlDecode(payload);

  if (decodedPayload.exp <= Math.floor(Date.now() / 1000)) {
    throw new Error("Access token expired");
  }

  return decodedPayload;
}

function generateRefreshTokenValue() {
  return crypto.randomBytes(48).toString("base64url");
}

function getRequestDeviceInfo(req) {
  return (
    req.body?.device_info ||
    req.get?.("x-device-info") ||
    req.get?.("user-agent") ||
    "Unknown device"
  );
}

async function createRefreshToken(subjectType, principal, req, familyId) {
  const config = subjectConfig[subjectType];
  const rawToken = generateRefreshTokenValue();
  const tokenHash = RefreshToken.hashToken(rawToken);
  const expiresAt = new Date(Date.now() + config.refreshTokenSeconds * 1000);

  await RefreshToken.create({
    subject_type: subjectType,
    subject_model: config.modelName,
    subject: principal._id,
    subject_public_id: principal[config.publicIdField],
    token_hash: tokenHash,
    family_id: familyId || crypto.randomUUID(),
    device_info: getRequestDeviceInfo(req),
    ip_address: req.ip,
    user_agent: req.get?.("user-agent"),
    expires_at: expiresAt,
  });

  return {
    token: rawToken,
    token_hash: tokenHash,
    expires_at: expiresAt,
    expires_in: config.refreshTokenSeconds,
  };
}

async function issueTokenPair(subjectType, principal, req, familyId) {
  const access = createAccessToken(subjectType, principal);
  const refresh = await createRefreshToken(subjectType, principal, req, familyId);

  return { access, refresh };
}

async function rotateRefreshToken(rawRefreshToken, req) {
  const tokenHash = RefreshToken.hashToken(rawRefreshToken);
  const storedToken = await RefreshToken.findOne({ token_hash: tokenHash }).populate(
    "subject",
  );

  if (!storedToken || storedToken.revoked_at || storedToken.expires_at <= new Date()) {
    throw new Error("Invalid or expired refresh token");
  }

  // Refresh Token Rotation: every use burns the current token and replaces it.
  storedToken.revoked_at = new Date();
  storedToken.revoked_reason = "ROTATED";
  storedToken.last_used_at = new Date();
  await storedToken.save();

  const tokenPair = await issueTokenPair(
    storedToken.subject_type,
    storedToken.subject,
    req,
    storedToken.family_id,
  );

  storedToken.replaced_by_token_hash = tokenPair.refresh.token_hash;
  await storedToken.save();

  return {
    subject_type: storedToken.subject_type,
    principal: storedToken.subject,
    ...tokenPair,
  };
}

async function revokeRefreshToken(rawRefreshToken, reason = "LOGOUT") {
  const tokenHash = RefreshToken.hashToken(rawRefreshToken);

  return RefreshToken.findOneAndUpdate(
    { token_hash: tokenHash, revoked_at: null },
    { revoked_at: new Date(), revoked_reason: reason },
    { new: true },
  );
}

function getSubjectConfig(subjectType) {
  return subjectConfig[subjectType];
}

module.exports = {
  createAccessToken,
  verifyAccessToken,
  issueTokenPair,
  rotateRefreshToken,
  revokeRefreshToken,
  getSubjectConfig,
};
