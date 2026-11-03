# 02 — Auth: Login `/login` + Register `/register`

> Patient self-register only (immediate active), staff/admin created by Admin. Fields confirmed: full name, birthdate, sex, address, contact number, email, password+confirm, household number, PhilHealth (optional), emergency contact name+number, DPA consent. Redirect by role: patient `/app/dashboard`, staff `/staff/dashboard`, admin `/admin/dashboard`.

## 1. Layout options

- **A. Centered card on soft gradient (recommended).** Single column login (max-w 420px); register 2-step or 2-col on desktop (Personal → Account), 1-col stacked on mobile. Card white, soft shadow, gradient wash behind (static).
  - *Pros:* familiar, focused, fast; matches clinical trust. *Cons:* register long — needs grouping.
- **B. Split-screen illustration + form.** Pretty but wastes space on phones, illustration adds load + distraction for elderly.
- **C. Full-page sheet modal from landing.** Fluid (anchored origin) but breaks deep-linking + password-manager expectations.

**Recommendation: A.** Login one screen; Register grouped sections with progress (Step 1 Personal / Step 2 Household & Emergency / Step 3 Account + Consent), Back preserves input (forgiveness/Agency).

## 2. Information hierarchy & forms

Login: email → password (show/hide) → [Log in] primary → links (Register as patient, Forgot placeholder disabled with tooltip "Ask front desk for reset — v1"). Error `role=alert` ("Wrong password") without revealing which field.

Register groups:
1. Personal: full name, birthdate (date picker, no future), sex (segmented M/F + Other/Prefer not — confirm options), address.
2. Household: household number, contact number (PH format hint), PhilHealth optional, emergency name + number.
3. Account: email, password (at least 8 characters and at least two of letters, numbers, and special characters), confirm, DPA checkbox required (short text + version). Submit disabled until consent.

Inline validation on blur + submit (mirror Zod); success → toast + auto-login → dashboard. Never clear password on error except mismatch.

## 3. Components

shadcn Input/Select/Date, segmented control, password toggle (lucide Eye), Checkbox, Button, Alert. Labels always visible (no placeholder-only). 44px+ targets.

## 4. Interactions

- Pointer-down button feedback (scale 0.97, 100ms); commit on up.
- Step transitions: critically damped slide+fade from presentation value, symmetric back path; interruptible (rapid Back/Next doesn't trap). Reduced motion → cross-fade.
- Caps-lock hint, show/hide animates opacity only.
- Dim scrim not needed (full page, not modal).

## 5. Responsive

- Desktop register 2-col within card (max-w 720px); mobile single col, sticky bottom [Continue]/[Create account] with safe-area padding, keyboard avoids covering input (scroll into view).
- Text scales with rem; layout survives 200% zoom.

## 6. Edge cases / acceptance

- [ ] Duplicate email → inline "Email already registered. Log in?" link.
- [ ] Optional PhilHealth skippable; required fields marked *.
- [ ] No staff self-register path exposed.
- [ ] Failed login doesn't leak user existence; audit logs staff logins (not patient fails v1).
