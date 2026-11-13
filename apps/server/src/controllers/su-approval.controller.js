import { logActivity } from '../services/activity.js';
import { cancelApproval, decideByToken, describeByToken, getOwnedApproval } from '../services/su-approval.js';

/**
 * Endpoints behind the superadmin email confirmation (see requireSuperPin.js).
 *
 * - status / cancel: the requesting admin, signed in, using the approval id the
 *   PIN step returned.
 * - describe / confirm / deny: the superadmin, from the emailed link. No sign-in:
 *   the unguessable single-use token is the credential, and it only exists
 *   because someone already entered the correct PIN.
 */

const GONE_MESSAGES = {
  unknown: 'This confirmation link is not valid.',
  expired: 'This confirmation link has expired. Nothing was changed.',
  used: 'This request was already confirmed and applied.',
  approved: 'This request was already confirmed.',
  denied: 'This request was already denied.',
  cancelled: 'The admin cancelled this request. Nothing was changed.',
};

export function approvalStatus(req, res) {
  const owned = getOwnedApproval(req.params.id, req.user.id);
  if (!owned) {
    return res.status(404).json({ success: false, code: 'APPROVAL_EXPIRED', message: 'That confirmation was not found.' });
  }
  return res.json({
    success: true,
    status: owned.status,
    label: owned.view.label,
    expiresAt: owned.view.expiresAt,
  });
}

export function approvalCancel(req, res) {
  cancelApproval(req.params.id, req.user.id);
  return res.json({ success: true });
}

export function approvalDescribe(req, res) {
  const info = describeByToken(req.params.token);
  if (!info) {
    return res.status(404).json({ success: false, code: 'APPROVAL_UNKNOWN', message: GONE_MESSAGES.unknown });
  }
  return res.json({ success: true, approval: info });
}

function decide(decision) {
  return async (req, res) => {
    const result = decideByToken(req.params.token, decision);
    if (!result.ok) {
      const status = result.status === 'unknown' ? 404 : 410;
      return res.status(status).json({
        success: false,
        code: `APPROVAL_${result.status.toUpperCase()}`,
        message: GONE_MESSAGES[result.status] ?? GONE_MESSAGES.unknown,
        status: result.status,
      });
    }
    const confirmed = decision === 'confirm';
    await logActivity({
      req,
      action: confirmed ? 'settings.approval_confirmed' : 'settings.approval_denied',
      actorName: 'Superadmin (email link)',
      outcome: confirmed ? 'success' : 'failed',
      target: { type: 'settings', id: 'superadmin-approval', label: result.record.label },
      detail: confirmed
        ? `Superadmin confirmed by email. Requested by ${result.record.requestedBy}.`
        : `Superadmin denied by email. Requested by ${result.record.requestedBy}.`,
    });
    return res.json({ success: true, status: result.status });
  };
}

export const approvalConfirm = decide('confirm');
export const approvalDeny = decide('deny');
