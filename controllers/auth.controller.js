const crypto = require("crypto");
const User = require("../models/user.model");
const Business = require("../models/business.model");
const Admin = require("../models/admin.model");
const Rider = require("../models/rider.model");
const PasswordResetToken = require("../models/passwordResetToken.model");
const EmailVerificationCode = require("../models/emailVerificationCode.model");
const RefreshToken = require("../models/refreshToken.model");
const {
  issueTokenPair,
  rotateRefreshToken,
  revokeRefreshToken,
} = require("../services/token.service");
const {
  reserveVirtualAccount,
  deallocateVirtualAccount,
} = require("../services/monnify.service");
const {
  createWalletFromMonnifyAccount,
} = require("../services/wallet.service");
const {
  sendPasswordResetEmail,
  sendEmailVerificationCode,
} = require("../services/email.service");
const { verifyGoogleIdToken } = require("../services/firebase.service");

const PASSWORD_RESET_EXPIRES_MINUTES = 15;
const EMAIL_VERIFICATION_EXPIRES_MINUTES = 10;

const actorConfig = {
  USER: {
    Model: User,
    publicIdField: "id",
    emailPath: "profile.email",
    phonePath: "profile.phone_number",
    name(actor) {
      return `${actor.profile.first_name} ${actor.profile.last_name}`.trim();
    },
    email(actor) {
      return actor.profile.email;
    },
    accountName(actor) {
      return `Oloja ${this.name(actor)}`;
    },
  },
  BUSINESS: {
    Model: Business,
    publicIdField: "id",
    emailPath: "contact_email",
    phonePath: "phone_number",
    name(actor) {
      return actor.name;
    },
    email(actor) {
      return actor.contact_email;
    },
    accountName(actor) {
      return `Oloja ${actor.name}`;
    },
  },
  ADMIN: {
    Model: Admin,
    publicIdField: "id",
    emailPath: "profile.email",
    phonePath: "profile.phone_number",
    name(actor) {
      return actor.profile.full_name;
    },
    email(actor) {
      return actor.profile.email;
    },
    accountName(actor) {
      return `Oloja Admin ${actor.profile.full_name}`;
    },
  },
  RIDER: {
    Model: Rider,
    publicIdField: "id",
    emailPath: "personal_info.email",
    phonePath: "personal_info.phone_number",
    name(actor) {
      return actor.personal_info.full_name;
    },
    email(actor) {
      return actor.personal_info.email;
    },
    accountName(actor) {
      return `Oloja Rider ${actor.personal_info.full_name}`;
    },
  },
};

function getCookie(req, name) {
  const cookieHeader = req.headers.cookie;
  if (!cookieHeader) return undefined;

  const cookies = Object.fromEntries(
    cookieHeader.split(";").map((cookie) => {
      const [key, ...value] = cookie.trim().split("=");
      return [key, decodeURIComponent(value.join("="))];
    }),
  );

  return cookies[name];
}

function getValueByPath(object, path) {
  return path.split(".").reduce((value, key) => value?.[key], object);
}

function setAdminRefreshCookie(res, refreshToken, expiresAt) {
  res.cookie("refresh_token", refreshToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    expires: expiresAt,
    path: "/api/v1/auth/refresh",
  });
}

function clearAdminRefreshCookie(res) {
  res.clearCookie("refresh_token", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/api/v1/auth/refresh",
  });
}

function publicActor(actor) {
  const object = actor.toObject ? actor.toObject() : actor;

  if (object.auth) {
    delete object.auth.password;
  }

  return object;
}

function pickPassword(body) {
  console.log(body);
  return body.password || body.auth?.password;
}

function makePublicId(prefix) {
  return `${prefix}_${crypto.randomBytes(6).toString("hex")}`;
}

function buildResetLink(rawToken, subjectType) {
  const baseUrl =
    process.env.PASSWORD_RESET_URL ||
    process.env.FRONTEND_PASSWORD_RESET_URL ||
    "http://localhost:3000/reset-password";
  const url = new URL(baseUrl);

  url.searchParams.set("token", rawToken);
  url.searchParams.set("subject_type", subjectType);

  return url.toString();
}

function getActorName(subjectType, actor) {
  return actorConfig[subjectType].name(actor);
}

function generateSixDigitCode() {
  return String(crypto.randomInt(100000, 1000000));
}

async function sendVerificationCode(subjectType, actor, req) {
  const config = actorConfig[subjectType];
  const email = config.email(actor);
  console.log(
    `this is the actor[config.publicIdField]:${actor[config.publicIdField]}`,
  );

  if (!email) {
    throw new Error("A valid email is required for verification");
  }

  const code = generateSixDigitCode();
  const codeHash = EmailVerificationCode.hashCode(code);
  const expiresAt = new Date(
    Date.now() + EMAIL_VERIFICATION_EXPIRES_MINUTES * 60 * 1000,
  );

  // Only the newest unused code should work.
  await EmailVerificationCode.updateMany(
    {
      subject_type: subjectType,
      subject_public_id: actor[config.publicIdField],
      used_at: null,
    },
    { used_at: new Date() },
  );

  await EmailVerificationCode.create({
    subject_type: subjectType,
    subject_model: config.Model.modelName,
    subject: actor._id,
    subject_public_id: actor[config.publicIdField],
    email,
    code_hash: codeHash,
    expires_at: expiresAt,
    ip_address: req.ip,
    user_agent: req.get("user-agent"),
  });

  await sendEmailVerificationCode({
    to: email,
    name: getActorName(subjectType, actor),
    code,
    expiresInMinutes: EMAIL_VERIFICATION_EXPIRES_MINUTES,
  });
}

async function createWalletAndSession(
  subjectType,
  actor,
  req,
  res,
  options = {},
) {
  console.log("Creating wallet and session for", subjectType, actor);
  const issueSession = options.issueSession !== false;
  const config = await actorConfig[subjectType];

  if (config === undefined) {
    throw new Error(`Unsupported subject type: ${subjectType}`);
  }

  const kyc = {
    bvn: req.body.kyc?.bvn || req.body.monnify_kyc?.bvn,
    nin: req.body.kyc?.nin || req.body.monnify_kyc?.nin,
  };

  const monnifyAccount = await reserveVirtualAccount({
    ownerType: subjectType,
    ownerId: actor[config.publicIdField],
    accountName: config.accountName(actor),
    customerEmail: config.email(actor),
    customerName: config.name(actor),
    bvn: kyc.bvn,
    nin: kyc.nin,
  });

  await actor.save();
  const wallet = await createWalletFromMonnifyAccount({
    ownerType: subjectType,
    owner: actor,
    monnifyAccount,
    kyc,
  });

  if (!issueSession) {
    return { wallet };
  }

  const tokens = await issueTokenPair(subjectType, actor, req);

  if (subjectType === "ADMIN") {
    setAdminRefreshCookie(res, tokens.refresh.token, tokens.refresh.expires_at);
  }

  return { wallet, tokens };
}

async function completeRegistration(subjectType, actor, req, res) {
  try {
    console.log(req.body);
    const config = actorConfig[subjectType];
    const password = pickPassword(req.body);

    if (!password) {
      return res.status(400).json({ message: "Password is required" });
    }

    actor.auth = { ...(actor.auth || {}), password };

    const validationError = actor.validateSync();
    if (validationError) {
      return res.status(400).json({ message: validationError.message });
    }

    const customerEmail = config.email(actor);
    if (!customerEmail) {
      return res.status(400).json({
        message:
          "A valid email is required to create a Monnify virtual account",
      });
    }

    const duplicateChecks = [
      { _id: actor._id },
      { [config.emailPath]: customerEmail },
      { [config.phonePath]: getValueByPath(actor, config.phonePath) },
    ].filter((condition) => Object.values(condition)[0]);

    const existingActor = await config.Model.findOne({
      $or: duplicateChecks,
    }).select("_id");

    if (existingActor) {
      return res.status(409).json({
        message: `${subjectType.toLowerCase()} already exists`,
      });
    }

    // Reserve the Monnify NUBAN, save the actor, create wallet, then issue tokens.
    // If anything fails after reservation, delete the reservation.
    let walletResult;
    try {
      walletResult = await createWalletAndSession(
        subjectType,
        actor,
        req,
        res,
        {
          issueSession: false,
        },
      );
    } catch (walletErr) {
      // If wallet creation fails after Monnify reservation, delete the reservation
      console.error(
        "Wallet creation failed, cleaning up Monnify reservation:",
        walletErr,
      );
      await deallocateVirtualAccount(subjectType, actor[config.publicIdField]);
      throw walletErr;
    }

    const { wallet } = walletResult;

    try {
      await sendVerificationCode(subjectType, actor, req);
    } catch (emailErr) {
      // If email sending fails, delete the reservation and propagate error
      console.error(
        "Email verification failed, cleaning up Monnify reservation:",
        emailErr,
      );
      await deallocateVirtualAccount(subjectType, actor[config.publicIdField]);
      throw emailErr;
    }

    return res.status(201).json({
      message: `${subjectType.toLowerCase()} registered successfully. Verification code sent to email.`,
      data: {
        actor: publicActor(actor),
        wallet,
        requires_email_verification: !actor.auth?.email_verified,
      },
    });
  } catch (err) {
    console.error("Error in completeRegistration:", err);
    throw err;
  }
}

function buildLoginQuery(subjectType, identifier) {
  const config = actorConfig[subjectType];
  const query = [];

  query.push({ [config.emailPath]: identifier.toLowerCase?.() || identifier });
  query.push({ [config.phonePath]: identifier });

  return { $or: query };
}

async function registerClient(req, res, next) {
  try {
    return completeRegistration("USER", new User(req.body), req, res);
  } catch (err) {
    next(err);
  }
}

async function registerClientWithGoogle(req, res, next) {
  try {
    const decodedToken = await verifyGoogleIdToken(req.body.id_token);
    const [firstName, ...lastNameParts] = (decodedToken.name || "").split(" ");
    const profile = req.body.profile || {};

    const user = new User({
      account_type: "B2C_CUSTOMER",
      profile: {
        first_name: profile.first_name || firstName || "Oloja",
        last_name: profile.last_name || lastNameParts.join(" ") || "Customer",
        email: decodedToken.email,
        phone_number:
          profile.phone_number ||
          req.body.phone_number ||
          decodedToken.phone_number,
      },
      auth: {
        provider: "GOOGLE",
        firebase_uid: decodedToken.uid,
        email_verified: Boolean(decodedToken.email_verified),
        email_verified_at: decodedToken.email_verified ? new Date() : undefined,
      },
      saved_locations: req.body.saved_locations || [],
      account_status: "ACTIVE",
    });

    const validationError = user.validateSync();
    if (validationError) {
      return res.status(400).json({ message: validationError.message });
    }

    const existingUser = await User.findOne({
      $or: [
        { "auth.firebase_uid": decodedToken.uid },
        { "profile.email": decodedToken.email },
      ],
    }).select("_id");

    if (existingUser) {
      return res.status(409).json({ message: "user already exists" });
    }

    const { wallet, tokens } = await createWalletAndSession(
      "USER",
      user,
      req,
      res,
      {
        issueSession: user.auth.email_verified,
      },
    );

    if (!user.auth.email_verified) {
      await sendVerificationCode("USER", user, req);
    }

    return res.status(201).json({
      message: user.auth.email_verified
        ? "Google client registered successfully"
        : "Google client registered successfully. Verification code sent to email.",
      data: {
        actor: publicActor(user),
        wallet,
        requires_email_verification: !user.auth.email_verified,
        access_token: tokens?.access.token,
        access_token_expires_in: tokens?.access.expires_in,
        refresh_token: tokens?.refresh.token,
        refresh_token_expires_at: tokens?.refresh.expires_at,
      },
    });
  } catch (err) {
    next(err);
  }
}

async function registerBusiness(req, res, next) {
  try {
    return completeRegistration("BUSINESS", new Business(req.body), req, res);
  } catch (err) {
    next(err);
  }
}

async function registerAdmin(req, res, next) {
  try {
    return completeRegistration("ADMIN", new Admin(req.body), req, res);
  } catch (err) {
    next(err);
  }
}

async function registerRider(req, res, next) {
  try {
    return completeRegistration("RIDER", new Rider(req.body), req, res);
  } catch (err) {
    next(err);
  }
}

async function loginActor(subjectType, req, res, next) {
  try {
    const config = actorConfig[subjectType];
    const identifier =
      req.body.email || req.body.phone_number || req.body.identifier;
    const password = pickPassword(req.body);

    if (!identifier || !password) {
      return res
        .status(400)
        .json({ message: "Identifier and password are required" });
    }

    const actor = await config.Model.findOne(
      buildLoginQuery(subjectType, identifier),
    )
      .select("+auth.password")
      .populate("delivery_wallet");
    console.log(`Login successful for ${subjectType}:`, actor);

    if (!actor || !(await actor.comparePassword(password))) {
      return res.status(401).json({ message: "Invalid login credentials" });
    }

    if (actor.account_status && actor.account_status !== "ACTIVE") {
      return res.status(403).json({ message: "Account is not active" });
    }

    if (actor.status && actor.status !== "ACTIVE") {
      return res.status(403).json({ message: "Account is not active" });
    }

    if (!actor.auth?.email_verified) {
      return res.status(403).json({
        message: "Email verification is required before login",
        requires_email_verification: true,
      });
    }

    actor.auth.last_login_at = new Date();
    await actor.save();

    const tokens = await issueTokenPair(subjectType, actor, req);

    if (subjectType === "ADMIN") {
      setAdminRefreshCookie(
        res,
        tokens.refresh.token,
        tokens.refresh.expires_at,
      );
    }

    return res.json({
      message: "Login successful",
      success: true,
      data: {
        user: publicActor(actor),
        tokens: {
          accessToken: tokens.access.token,
          refreshToken:
            subjectType === "ADMIN" ? undefined : tokens.refresh.token,
          expiresIn: tokens.access.expires_in,
        },
        refresh_token_expires_at: tokens.refresh.expires_at,
      },
    });
  } catch (err) {
    console.log(`Error in loginActor for ${subjectType}:`, err);
    next(err);
  }
}

const loginClient = (req, res, next) => loginActor("USER", req, res, next);
const loginBusiness = (req, res, next) =>
  loginActor("BUSINESS", req, res, next);
const loginAdmin = (req, res, next) => loginActor("ADMIN", req, res, next);
const loginRider = (req, res, next) => loginActor("RIDER", req, res, next);

async function loginClientWithGoogle(req, res, next) {
  try {
    const decodedToken = await verifyGoogleIdToken(req.body.id_token);
    const user = await User.findOne({
      $or: [
        { "auth.firebase_uid": decodedToken.uid },
        { "profile.email": decodedToken.email },
      ],
    }).populate("delivery_wallet");

    if (!user) {
      return res
        .status(404)
        .json({ message: "Google client account was not found" });
    }

    if (user.account_status !== "ACTIVE") {
      return res.status(403).json({ message: "Account is not active" });
    }

    if (!user.auth.firebase_uid) {
      user.auth.firebase_uid = decodedToken.uid;
      user.auth.provider = "GOOGLE";
    }

    if (decodedToken.email_verified && !user.auth.email_verified) {
      user.auth.email_verified = true;
      user.auth.email_verified_at = new Date();
    }

    if (!user.auth.email_verified) {
      return res.status(403).json({
        message: "Email verification is required before login",
        requires_email_verification: true,
      });
    }

    user.auth.last_login_at = new Date();
    await user.save();

    const tokens = await issueTokenPair("USER", user, req);

    return res.json({
      message: "Google login successful",
      data: {
        actor: publicActor(user),
        access_token: tokens.access.token,
        access_token_expires_in: tokens.access.expires_in,
        refresh_token: tokens.refresh.token,
        refresh_token_expires_at: tokens.refresh.expires_at,
      },
    });
  } catch (err) {
    next(err);
  }
}

async function verifyEmail(req, res, next) {
  try {
    const subjectType = String(req.body.subject_type || "USER").toUpperCase();
    const code = String(req.body.code || "").trim();
    const config = actorConfig[subjectType];

    if (!config || !/^\d{6}$/.test(code)) {
      return res.status(400).json({
        message: "A valid subject_type and six-digit code are required",
      });
    }

    const email = String(req.body.email || "")
      .toLowerCase()
      .trim();
    const publicId = req.body.public_id || req.body[config.publicIdField];
    const lookup = publicId
      ? { _id: publicId }
      : { [config.emailPath]: email };

    if (!publicId && !email) {
      return res
        .status(400)
        .json({ message: "Email or public_id is required" });
    }

    const actor = await config.Model.findOne(lookup);

    if (!actor) {
      return res.status(404).json({ message: "Account was not found" });
    }

    if (actor.auth?.email_verified) {
      return res.json({ message: "Email is already verified" });
    }

    const verificationCode = await EmailVerificationCode.findOne({
      subject_type: subjectType,
      subject_public_id: actor[config.publicIdField],
      code_hash: EmailVerificationCode.hashCode(code),
      used_at: null,
      expires_at: { $gt: new Date() },
    }).sort({ createdAt: -1 });

    if (!verificationCode) {
      return res.status(400).json({
        message: "Verification code is invalid or expired",
      });
    }

    actor.auth.email_verified = true;
    actor.auth.email_verified_at = new Date();
    await actor.save();

    verificationCode.used_at = new Date();
    await verificationCode.save();

    return res.json({
      message: "Email verified successfully",
      data: { actor: publicActor(actor) },
    });
  } catch (err) {
    next(err);
  }
}

async function resendEmailVerification(req, res, next) {
  try {
    const subjectType = String(req.body.subject_type || "USER").toUpperCase();
    const config = actorConfig[subjectType];

    if (!config) {
      return res
        .status(400)
        .json({ message: "A valid subject_type is required" });
    }

    const email = String(req.body.email || "")
      .toLowerCase()
      .trim();
    const publicId = req.body.public_id || req.body[config.publicIdField];
    const lookup = publicId
      ? { _id: publicId }
      : { [config.emailPath]: email };

    if (!publicId && !email) {
      return res
        .status(400)
        .json({ message: "Email or public_id is required" });
    }

    const actor = await config.Model.findOne(lookup);

    if (!actor) {
      return res.status(404).json({ message: "Account was not found" });
    }

    if (actor.auth?.email_verified) {
      return res.json({ message: "Email is already verified" });
    }

    await sendVerificationCode(subjectType, actor, req);

    return res.json({ message: "Verification code sent to email" });
  } catch (err) {
    next(err);
  }
}

async function requestPasswordReset(req, res, next) {
  try {
    const subjectType = String(req.body.subject_type || "USER").toUpperCase();
    const email = String(req.body.email || "")
      .toLowerCase()
      .trim();
    const config = actorConfig[subjectType];

    if (!config || !email) {
      return res
        .status(400)
        .json({ message: "A valid subject_type and email are required" });
    }

    const actor = await config.Model.findOne({ [config.emailPath]: email });

    // Always return a generic success so attackers cannot discover registered emails.
    if (!actor) {
      return res.json({
        message: "If that email exists, a password reset link has been sent",
      });
    }

    const rawToken = crypto.randomBytes(32).toString("base64url");
    const tokenHash = PasswordResetToken.hashToken(rawToken);
    const expiresAt = new Date(
      Date.now() + PASSWORD_RESET_EXPIRES_MINUTES * 60 * 1000,
    );

    await PasswordResetToken.create({
      subject_type: subjectType,
      subject_model: config.Model.modelName,
      subject: actor._id,
      subject_public_id: actor[config.publicIdField],
      token_hash: tokenHash,
      email,
      expires_at: expiresAt,
      ip_address: req.ip,
      user_agent: req.get("user-agent"),
    });

    await sendPasswordResetEmail({
      to: email,
      name: getActorName(subjectType, actor),
      resetLink: buildResetLink(rawToken, subjectType),
      expiresInMinutes: PASSWORD_RESET_EXPIRES_MINUTES,
    });

    return res.json({
      message: "If that email exists, a password reset link has been sent",
    });
  } catch (err) {
    next(err);
  }
}

async function resetPassword(req, res, next) {
  try {
    const token = req.body.token;
    const newPassword = pickPassword(req.body);

    if (!token || !newPassword) {
      return res
        .status(400)
        .json({ message: "Token and new password are required" });
    }

    if (String(newPassword).length < 8) {
      return res
        .status(400)
        .json({ message: "Password must be at least 8 characters" });
    }

    const tokenHash = PasswordResetToken.hashToken(token);
    const resetToken = await PasswordResetToken.findOne({
      token_hash: tokenHash,
      used_at: null,
      expires_at: { $gt: new Date() },
    }).populate("subject");

    if (!resetToken || !resetToken.subject) {
      return res
        .status(400)
        .json({ message: "Password reset link is invalid or expired" });
    }

    const actor = resetToken.subject;
    actor.auth = { ...(actor.auth || {}), password: newPassword };

    if (resetToken.subject_type === "USER" && !actor.auth.provider) {
      actor.auth.provider = "PASSWORD";
    }

    await actor.save();

    resetToken.used_at = new Date();
    await resetToken.save();

    // Password reset invalidates every active refresh token for that actor.
    await RefreshToken.updateMany(
      {
        subject_type: resetToken.subject_type,
        subject_public_id: resetToken.subject_public_id,
        revoked_at: null,
      },
      {
        revoked_at: new Date(),
        revoked_reason: "PASSWORD_RESET",
      },
    );

    return res.json({ message: "Password reset successful" });
  } catch (err) {
    next(err);
  }
}

async function refresh(req, res, next) {
  try {
    const refreshToken =
      req.body.refresh_token || getCookie(req, "refresh_token");

    if (!refreshToken) {
      return res.status(401).json({ message: "Refresh token is required" });
    }

    // RTR: the used refresh token is revoked and replaced every time.
    const rotated = await rotateRefreshToken(refreshToken, req);

    if (rotated.subject_type === "ADMIN") {
      setAdminRefreshCookie(
        res,
        rotated.refresh.token,
        rotated.refresh.expires_at,
      );
    }

    return res.json({
      message: "Session refreshed",
      data: {
        access_token: rotated.access.token,
        access_token_expires_in: rotated.access.expires_in,
        refresh_token:
          rotated.subject_type === "ADMIN" ? undefined : rotated.refresh.token,
        refresh_token_expires_at: rotated.refresh.expires_at,
      },
    });
  } catch (err) {
    return res.status(401).json({ message: err.message });
  }
}

async function logout(req, res, next) {
  try {
    const refreshToken =
      req.body.refresh_token || getCookie(req, "refresh_token");

    if (refreshToken) {
      await revokeRefreshToken(refreshToken, "LOGOUT");
    }

    clearAdminRefreshCookie(res);

    return res.json({ message: "Logged out successfully" });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  registerClient,
  registerClientWithGoogle,
  registerBusiness,
  registerAdmin,
  registerRider,
  loginClient,
  loginClientWithGoogle,
  loginBusiness,
  loginAdmin,
  loginRider,
  verifyEmail,
  resendEmailVerification,
  refresh,
  logout,
  requestPasswordReset,
  resetPassword,
};
