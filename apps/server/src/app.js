import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import morgan from 'morgan';
import { env } from './config/env.js';
import { errorHandler } from './middleware/errorHandler.js';
import { notFound } from './middleware/notFound.js';
import { requestContext } from './middleware/requestContext.js';
import { apiRouter } from './routes/index.js';

export function createApp() {
  const app = express();

  // Only meaningful when this server renders HTML; the SPA is served by Vite.
  // Kept in sync so an eventual single-origin deploy can load the widget.
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          ...helmet.contentSecurityPolicy.getDefaultDirectives(),
          'script-src': [
            "'self'",
            'https://www.google.com/recaptcha/',
            'https://www.gstatic.com/recaptcha/',
          ],
          'frame-src': ["'self'", 'https://www.google.com/recaptcha/'],
        },
      },
    }),
  );
  // Required behind Nginx/Render/Railway: without it rate limits and activity
  // logs see the proxy's IP instead of the client's.
  if (env.TRUST_PROXY > 0) app.set('trust proxy', env.TRUST_PROXY);
  app.use(cors({ origin: env.CLIENT_URL }));
  app.use(express.json());
  app.use(morgan(env.NODE_ENV === 'production' ? 'combined' : 'dev'));
  // Client IP + user agent for every activity entry written downstream.
  app.use(requestContext);

  app.use('/api', apiRouter);

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
