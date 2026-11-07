export function errorHandler(err, _req, res, _next) {
  console.error(err);

  // Mongoose optimistic concurrency: the document was changed by someone else
  // between the read and this save. The client should reload and retry.
  if (err?.name === 'VersionError') {
    return res.status(409).json({
      success: false,
      code: 'VERSION_CONFLICT',
      message: 'This record was changed by someone else. Reload and try again.',
    });
  }

  // Unique index race: two requests inserted the same email/name at once.
  if (err?.code === 11000) {
    return res.status(409).json({
      success: false,
      code: 'DUPLICATE_KEY',
      message: 'That value is already in use. Reload and try again.',
    });
  }

  // Schema validation raised outside a controller's own safeParse.
  if (err?.name === 'ValidationError') {
    const errors = {};
    for (const [field, detail] of Object.entries(err.errors ?? {})) {
      errors[field] = [detail?.message ?? 'Invalid value.'];
    }
    return res.status(400).json({
      success: false,
      code: 'VALIDATION_ERROR',
      message: 'Validation failed.',
      errors,
    });
  }

  // A value (often a URL id) could not be cast to the field's type.
  if (err?.name === 'CastError') {
    return res.status(400).json({
      success: false,
      code: 'INVALID_VALUE',
      message: 'Invalid id or value in the request.',
    });
  }

  const status =
    typeof err === 'object' && err !== null && 'status' in err
      ? Number(err.status) || 500
      : 500;
  const message = err instanceof Error ? err.message : 'Internal server error';
  res.status(status).json({ success: false, message });
}
