const nodemailer = require("nodemailer");

let transporter;

function getTransporter() {
  if (transporter) return transporter;

  const required = ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS"];
  const missing = required.filter((key) => !process.env[key]);

  if (missing.length) {
    throw new Error(
      `Missing email environment variables: ${missing.join(", ")}`,
    );
  }

  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT),
    secure: process.env.SMTP_SECURE === "true",
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });

  return transporter;
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function buildPasswordResetEmail({ name, resetLink, expiresInMinutes }) {
  const safeName = escapeHtml(name || "there");
  const safeResetLink = escapeHtml(resetLink);

  return `
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Reset your Oloja password</title>
  </head>
  <body style="margin:0;padding:0;background:#f4f7fb;font-family:Arial,Helvetica,sans-serif;color:#172033;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f7fb;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:8px;overflow:hidden;border:1px solid #e4e9f2;">
            <tr>
              <td style="background:#0f766e;padding:28px 32px;">
                <div style="font-size:24px;line-height:1.2;font-weight:700;color:#ffffff;">Oloja</div>
                <div style="font-size:14px;line-height:1.6;color:#d9fffa;margin-top:4px;">Secure account recovery</div>
              </td>
            </tr>
            <tr>
              <td style="padding:32px;">
                <h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;color:#101828;">Reset your password</h1>
                <p style="margin:0 0 16px;font-size:15px;line-height:1.7;color:#344054;">Hi ${safeName},</p>
                <p style="margin:0 0 24px;font-size:15px;line-height:1.7;color:#344054;">
                  We received a request to reset your Oloja password. Use the button below to choose a new password. This link expires in ${expiresInMinutes} minutes.
                </p>
                <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 24px;">
                  <tr>
                    <td style="border-radius:6px;background:#0f766e;">
                      <a href="${safeResetLink}" style="display:inline-block;padding:13px 22px;font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:6px;">Reset password</a>
                    </td>
                  </tr>
                </table>
                <p style="margin:0 0 12px;font-size:13px;line-height:1.6;color:#667085;">If the button does not work, paste this link into your browser:</p>
                <p style="margin:0 0 24px;font-size:13px;line-height:1.6;word-break:break-all;color:#0f766e;">${safeResetLink}</p>
                <p style="margin:0;font-size:13px;line-height:1.6;color:#667085;">
                  If you did not request this, you can safely ignore this email. Your password will remain unchanged.
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:20px 32px;background:#f8fafc;border-top:1px solid #e4e9f2;">
                <p style="margin:0;font-size:12px;line-height:1.6;color:#667085;">Oloja Delivery Wallet and Services Platform</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function buildEmailVerificationEmail({ name, code, expiresInMinutes }) {
  const safeName = escapeHtml(name || "there");
  const safeCode = escapeHtml(code);

  return `
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Verify your Oloja email</title>
  </head>
  <body style="margin:0;padding:0;background:#f4f7fb;font-family:Arial,Helvetica,sans-serif;color:#172033;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f7fb;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:8px;overflow:hidden;border:1px solid #e4e9f2;">
            <tr>
              <td style="background:#0f766e;padding:28px 32px;">
                <div style="font-size:24px;line-height:1.2;font-weight:700;color:#ffffff;">Oloja</div>
                <div style="font-size:14px;line-height:1.6;color:#d9fffa;margin-top:4px;">Email verification</div>
              </td>
            </tr>
            <tr>
              <td style="padding:32px;">
                <h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;color:#101828;">Confirm your email address</h1>
                <p style="margin:0 0 16px;font-size:15px;line-height:1.7;color:#344054;">Hi ${safeName},</p>
                <p style="margin:0 0 24px;font-size:15px;line-height:1.7;color:#344054;">
                  Use this verification code to finish setting up your Oloja account. The code expires in ${expiresInMinutes} minutes.
                </p>
                <div style="margin:0 0 24px;padding:18px 20px;border-radius:8px;background:#ecfdf5;border:1px solid #99f6e4;text-align:center;">
                  <div style="font-size:32px;line-height:1.2;font-weight:800;letter-spacing:8px;color:#0f766e;">${safeCode}</div>
                </div>
                <p style="margin:0;font-size:13px;line-height:1.6;color:#667085;">
                  If you did not create this account, you can safely ignore this email.
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:20px 32px;background:#f8fafc;border-top:1px solid #e4e9f2;">
                <p style="margin:0;font-size:12px;line-height:1.6;color:#667085;">Oloja Delivery Wallet and Services Platform</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

async function sendPasswordResetEmail({
  to,
  name,
  resetLink,
  expiresInMinutes,
}) {
  const from = process.env.EMAIL_FROM || process.env.SMTP_USER;

  return getTransporter().sendMail({
    from,
    to,
    subject: "Reset your Oloja password",
    html: buildPasswordResetEmail({ name, resetLink, expiresInMinutes }),
  });
}

async function sendEmailVerificationCode({ to, name, code, expiresInMinutes }) {
  const from = process.env.EMAIL_FROM || process.env.SMTP_USER;

  return getTransporter().sendMail({
    from,
    to,
    subject: "Verify your Oloja email",
    html: buildEmailVerificationEmail({ name, code, expiresInMinutes }),
  });
}

module.exports = {
  sendPasswordResetEmail,
  buildPasswordResetEmail,
  sendEmailVerificationCode,
  buildEmailVerificationEmail,
};
