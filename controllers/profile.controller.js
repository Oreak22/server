const User = require("../models/user.model");
const Business = require("../models/business.model");
const Admin = require("../models/admin.model");
const Rider = require("../models/rider.model");
const Wallet = require("../models/wallet.model");
const { updateReservedAccountKyc } = require("../services/monnify.service");

const actorConfig = {
  USER: {
    Model: User,
    editablePaths: [
      "profile.first_name",
      "profile.last_name",
      "profile.business_name",
      "profile.phone_number",
      "profile.avatar_url",
      "saved_locations",
      "b2b_config.preferred_billing_cycle",
    ],
  },
  BUSINESS: {
    Model: Business,
    editablePaths: [
      "name",
      "phone_number",
      "services_rendered",
      "locations",
      "open_status.is_open_now",
      "open_status.status",
      "open_status.reason",
      "business_hours",
    ],
  },
  ADMIN: {
    Model: Admin,
    editablePaths: [
      "profile.full_name",
      "profile.phone_number",
      "profile.avatar_url",
      "availability_status",
      "work_shift.timezone",
      "work_shift.working_days",
      "work_shift.starts_at",
      "work_shift.ends_at",
    ],
  },
  RIDER: {
    Model: Rider,
    editablePaths: [
      "personal_info.full_name",
      "personal_info.phone_number",
      "personal_info.emergency_contact",
      "personal_info.blood_group",
      "live_telemetry.current_status",
    ],
  },
};

function getActorConfig(subjectType) {
  return actorConfig[subjectType];
}

function getValueByPath(object, path) {
  return path.split(".").reduce((value, key) => value?.[key], object);
}

function hasOwnPath(object, path) {
  let current = object;

  for (const key of path.split(".")) {
    if (!current || !Object.prototype.hasOwnProperty.call(current, key)) {
      return false;
    }

    current = current[key];
  }

  return true;
}

function setValueByPath(target, path, value) {
  const keys = path.split(".");
  let current = target;

  keys.slice(0, -1).forEach((key) => {
    if (!current[key] || typeof current[key] !== "object") {
      current[key] = {};
    }

    current = current[key];
  });

  current[keys[keys.length - 1]] = value;
}

function pickPaths(source, paths) {
  return paths.reduce((picked, path) => {
    const value = getValueByPath(source, path);

    if (value !== undefined) {
      setValueByPath(picked, path, value);
    }

    return picked;
  }, {});
}

function normalizeIdentifier(value) {
  if (value === undefined || value === null) return undefined;
  return String(value).replace(/\s+/g, "").trim();
}

function last4(value) {
  const text = normalizeIdentifier(value);
  return text ? text.slice(-4) : undefined;
}

function publicWallet(wallet) {
  const object = wallet.toObject ? wallet.toObject() : wallet;

  if (object.monnify?.raw_response) {
    delete object.monnify.raw_response;
  }

  return object;
}

async function getCurrentActor(req) {
  const subjectType = req.auth?.subject_type;
  const config = getActorConfig(subjectType);

  if (!config) {
    return { subjectType, actor: null };
  }

  const actor = await config.Model.findById(req.auth.sub);
  return { subjectType, config, actor };
}

function getEditablePaths(subjectType, actor, config) {
  if (subjectType !== "USER" || actor?.account_type === "B2B_MERCHANT") {
    return config.editablePaths;
  }

  return config.editablePaths.filter(
    (path) =>
      path !== "profile.business_name" &&
      path !== "b2b_config.preferred_billing_cycle",
  );
}

function handleDuplicateKey(err, res, next) {
  if (err?.code !== 11000) {
    return next(err);
  }

  const field = Object.keys(err.keyPattern || err.keyValue || {})[0];

  return res.status(409).json({
    message: field ? `${field} already exists` : "Duplicate value exists",
  });
}

async function getEditableProfile(req, res, next) {
  try {
    const { subjectType, config, actor } = await getCurrentActor(req);

    if (!config) {
      return res.status(400).json({ message: "Unsupported subject type" });
    }

    if (!actor) {
      return res.status(404).json({ message: "Account was not found" });
    }

    return res.json({
      message: "Editable profile fetched successfully",
      data: {
        subject_type: subjectType,
        editable_fields: getEditablePaths(subjectType, actor, config),
        profile: pickPaths(
          actor.toObject(),
          getEditablePaths(subjectType, actor, config),
        ),
      },
    });
  } catch (err) {
    next(err);
  }
}

async function updateEditableProfile(req, res, next) {
  try {
    const { subjectType, config, actor } = await getCurrentActor(req);

    if (!config) {
      return res.status(400).json({ message: "Unsupported subject type" });
    }

    if (!actor) {
      return res.status(404).json({ message: "Account was not found" });
    }

    const editablePaths = getEditablePaths(subjectType, actor, config);
    const updates = editablePaths.filter((path) =>
      hasOwnPath(req.body, path),
    );

    if (!updates.length) {
      return res.status(400).json({
        message: "No editable profile fields were provided",
        editable_fields: editablePaths,
      });
    }

    updates.forEach((path) => {
      actor.set(path, getValueByPath(req.body, path));
    });

    await actor.save();

    return res.json({
      message: "Profile updated successfully",
      data: {
        subject_type: subjectType,
        editable_fields: editablePaths,
        profile: pickPaths(actor.toObject(), editablePaths),
      },
    });
  } catch (err) {
    return handleDuplicateKey(err, res, next);
  }
}

async function completeMonnifyKyc(req, res, next) {
  try {
    const subjectType = req.auth?.subject_type;

    if (!getActorConfig(subjectType)) {
      return res.status(400).json({ message: "Unsupported subject type" });
    }

    const bvn = normalizeIdentifier(req.body.bvn || req.body.kyc?.bvn);
    const nin = normalizeIdentifier(req.body.nin || req.body.kyc?.nin);

    if (!bvn && !nin) {
      return res.status(400).json({ message: "BVN or NIN is required" });
    }

    if (bvn && !/^\d{11}$/.test(bvn)) {
      return res.status(400).json({ message: "BVN must be 11 digits" });
    }

    if (nin && !/^\d{11}$/.test(nin)) {
      return res.status(400).json({ message: "NIN must be 11 digits" });
    }

    const wallet = await Wallet.findOne({
      owner_type: subjectType,
      owner: req.auth.sub,
    });

    if (!wallet) {
      return res.status(404).json({ message: "Wallet was not found" });
    }

    const accountReference = wallet.monnify?.account_reference;

    if (!accountReference) {
      return res.status(400).json({
        message: "Wallet does not have a Monnify account reference",
      });
    }

    const monnifyResponse = await updateReservedAccountKyc({
      accountReference,
      bvn,
      nin,
    });

    wallet.kyc_info = {
      ...(wallet.kyc_info?.toObject?.() || wallet.kyc_info || {}),
      status: "VERIFIED",
      bvn_last4: last4(bvn) || wallet.kyc_info?.bvn_last4,
      nin_last4: last4(nin) || wallet.kyc_info?.nin_last4,
      submitted_at: new Date(),
      verified_at: new Date(),
      rejection_reason: undefined,
      response_code: monnifyResponse.responseCode,
      response_message: monnifyResponse.responseMessage,
    };
    wallet.status = "ACTIVE";
    wallet.last_updated_at = new Date();
    await wallet.save();

    return res.json({
      message: "Monnify KYC completed successfully",
      data: { wallet: publicWallet(wallet) },
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getEditableProfile,
  updateEditableProfile,
  completeMonnifyKyc,
};
