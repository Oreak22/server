const crypto = require("crypto");

let cachedAccessToken;
let cachedAccessTokenExpiresAt = 0;

function getBaseUrl() {
  return process.env.MONNIFY_BASE_URL || "https://sandbox.monnify.com";
}

function assertMonnifyConfig() {
  const required = [
    "MONNIFY_API_KEY",
    "MONNIFY_SECRET_KEY",
    "MONNIFY_CONTRACT_CODE",
  ];
  const missing = required.filter((key) => !process.env[key]);

  if (missing.length) {
    throw new Error(`Missing Monnify environment variables: ${missing.join(", ")}`);
  }
}

async function getMonnifyAccessToken() {
  assertMonnifyConfig();

  if (cachedAccessToken && cachedAccessTokenExpiresAt > Date.now() + 60_000) {
    return cachedAccessToken;
  }

  const basicToken = Buffer.from(
    `${process.env.MONNIFY_API_KEY}:${process.env.MONNIFY_SECRET_KEY}`,
  ).toString("base64");

  const response = await fetch(`${getBaseUrl()}/api/v1/auth/login`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basicToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({}),
  });
  const payload = await response.json();

  if (!response.ok || !payload.requestSuccessful) {
    throw new Error(payload.responseMessage || "Monnify authentication failed");
  }

  cachedAccessToken = payload.responseBody.accessToken;
  cachedAccessTokenExpiresAt =
    Date.now() + Number(payload.responseBody.expiresIn || 3000) * 1000;

  return cachedAccessToken;
}

function buildAccountReference(ownerType, ownerId) {
  const prefix = process.env.MONNIFY_ACCOUNT_PREFIX || "oloja";
  return `${prefix}_${ownerType.toLowerCase()}_${ownerId}`.replace(/[^a-zA-Z0-9_-]/g, "_");
}

async function reserveVirtualAccount({
  ownerType,
  ownerId,
  accountName,
  customerEmail,
  customerName,
  bvn,
  nin,
}) {
  assertMonnifyConfig();

  const accessToken = await getMonnifyAccessToken();
  const requestBody = {
    accountReference: buildAccountReference(ownerType, ownerId),
    accountName,
    currencyCode: "NGN",
    contractCode: process.env.MONNIFY_CONTRACT_CODE,
    customerEmail,
    customerName,
    getAllAvailableBanks: true,
  };

  if (bvn) requestBody.bvn = bvn;
  if (nin) requestBody.nin = nin;

  const response = await fetch(
    `${getBaseUrl()}/api/v2/bank-transfer/reserved-accounts`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    },
  );
  const payload = await response.json();

  if (!response.ok || !payload.requestSuccessful) {
    throw new Error(payload.responseMessage || "Monnify reserved account failed");
  }

  return payload.responseBody;
}

function verifyWebhookSignature(rawBody, signature) {
  if (!signature || !process.env.MONNIFY_SECRET_KEY) return false;

  const computedSignature = crypto
    .createHmac("sha512", process.env.MONNIFY_SECRET_KEY)
    .update(rawBody)
    .digest("hex");

  const received = Buffer.from(signature.toLowerCase());
  const expected = Buffer.from(computedSignature);

  return received.length === expected.length && crypto.timingSafeEqual(received, expected);
}

module.exports = {
  reserveVirtualAccount,
  verifyWebhookSignature,
  buildAccountReference,
};
