/**
 * Stamps a small, immutable request context on every request so activity
 * entries can record where a change came from without each controller
 * re-reading headers.
 */
export function requestContext(req, _res, next) {
  const forwarded = req.headers['x-forwarded-for'];
  const first = (Array.isArray(forwarded) ? forwarded[0] : forwarded ?? '').split(',')[0].trim();
  const ip = (first || req.ip || req.socket?.remoteAddress || '')
    .replace(/^::ffff:/, '')
    .replace(/^::1$/, '127.0.0.1');
  const userAgent = String(req.headers['user-agent'] ?? '').slice(0, 300);
  req.ctx = { ip, userAgent };
  next();
}
