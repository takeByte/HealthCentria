import { createRouteHandler } from 'uploadthing/express';
import { resolveUploadThingToken } from '../utils/uploadthing-credentials.js';
import { uploadRouter } from './router.js';

// UploadThing reads its token when a handler is built, so the handler is
// rebuilt whenever the active token changes (an admin saved a new one in
// Settings). No restart needed.
let cached = { token: '', handler: null };

export async function uploadthingHandler(req, res, next) {
  try {
    const { token } = await resolveUploadThingToken();
    if (!token) {
      return res.status(503).json({ message: 'Image uploads are not set up yet. Ask an admin.' });
    }
    if (cached.token !== token || !cached.handler) {
      cached = { token, handler: createRouteHandler({ router: uploadRouter, config: { token } }) };
    }
    return cached.handler(req, res, next);
  } catch (err) {
    return next(err);
  }
}
