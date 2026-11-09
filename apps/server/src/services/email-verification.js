import { VerificationCode } from '../models/verification-code.model.js';
import { sendEmail } from '../utils/email.js';
import {
  EMAIL_VERIFICATION_PURPOSE,
  VERIFY_CODE_TTL_MINUTES,
  VERIFY_RESEND_COOLDOWN_SECONDS,
  generateEmailCode,
  hashEmailCode,
} from '../utils/email-verification.js';

/**
 * Issue and email a fresh verification code for an existing account.
 *
 * Only addresses already stored as accounts ever receive a code, so the public
 * registration form cannot be used to mail arbitrary inboxes. A repeat request
 * inside the cooldown keeps the current code valid and sends nothing.
 *
 * Returns { issued, cooling, sent } — never throws for mail failures.
 */
export async function issueEmailVerification(user, { force = false } = {}) {
  const email = String(user.email).toLowerCase();

  if (!force) {
    const recent = await VerificationCode.findOne({
      email,
      purpose: EMAIL_VERIFICATION_PURPOSE,
      consumedAt: null,
    })
      .sort({ createdAt: -1 })
      .select('createdAt')
      .lean();

    if (recent) {
      const elapsedMs = Date.now() - new Date(recent.createdAt).getTime();
      if (elapsedMs < VERIFY_RESEND_COOLDOWN_SECONDS * 1000) {
        return {
          issued: false,
          cooling: true,
          sent: false,
          retryAfter: Math.max(1, Math.ceil((VERIFY_RESEND_COOLDOWN_SECONDS * 1000 - elapsedMs) / 1000)),
        };
      }
    }
  }

  const code = generateEmailCode();

  // Only one live code per address: issuing a new one invalidates the old.
  await VerificationCode.deleteMany({ email, purpose: EMAIL_VERIFICATION_PURPOSE, consumedAt: null });
  await VerificationCode.create({
    email,
    purpose: EMAIL_VERIFICATION_PURPOSE,
    codeHash: hashEmailCode(code),
    expiresAt: new Date(Date.now() + VERIFY_CODE_TTL_MINUTES * 60 * 1000),
  });

  const result = await sendEmail(
    email,
    'Verify your HealthCentria email',
    [
      `Your HealthCentria verification code is ${code}.`,
      '',
      `Enter it in the app within ${VERIFY_CODE_TTL_MINUTES} minutes to confirm this address.`,
      'You can keep using your account while it is unverified — this just confirms we can reach you.',
      '',
      '— HealthCentria Barangay Health Center',
    ].join('\n'),
  );

  return { issued: true, cooling: false, sent: Boolean(result.sent) };
}
