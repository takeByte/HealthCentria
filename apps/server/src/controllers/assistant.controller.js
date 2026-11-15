import mongoose from 'mongoose';
import { z } from 'zod';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { askWorkersAi, buildSystemPrompt } from '../services/assistant.js';
import { resolveAssistantConfig } from '../utils/assistant-credentials.js';

/** What the browser sends: the running chat, kept in the page and never stored. */
const chatSchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string().trim().min(1).max(1500, 'Keep each message under 1,500 characters.'),
      }),
    )
    .min(1)
    .max(40),
});

const MAX_HISTORY = 12;

/** GET /api/assistant/status — lets the page say when the assistant is off or not set up. */
export const assistantStatus = asyncHandler(async (req, res) => {
  const config = await resolveAssistantConfig();
  res.json({ success: true, enabled: config.enabled, configured: config.configured });
});

/** POST /api/assistant/chat */
export const assistantChat = asyncHandler(async (req, res) => {
  const config = await resolveAssistantConfig();
  if (!config.enabled) {
    return res.status(503).json({
      success: false,
      code: 'ASSISTANT_OFF',
      message: 'The assistant is turned off right now.',
    });
  }
  if (!config.configured) {
    return res.status(503).json({
      success: false,
      code: 'ASSISTANT_NOT_CONFIGURED',
      message: 'The assistant is not set up yet. Please ask an admin.',
    });
  }
  if (mongoose.connection.readyState !== 1) {
    return res.status(503).json({ success: false, message: 'Database is not connected. Try again later.' });
  }

  const parsed = chatSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      success: false,
      message: parsed.error.issues[0]?.message ?? 'Send a message to start.',
    });
  }
  const history = parsed.data.messages.slice(-MAX_HISTORY);
  if (history[history.length - 1].role !== 'user') {
    return res.status(400).json({ success: false, message: 'The last message must be from you.' });
  }

  const system = await buildSystemPrompt(req.user.role);
  let reply;
  try {
    reply = await askWorkersAi([{ role: 'system', content: system }, ...history], config);
  } catch (error) {
    const timeout = error?.reason === 'timeout';
    return res.status(502).json({
      success: false,
      code: 'ASSISTANT_UNAVAILABLE',
      message: timeout
        ? 'The assistant took too long to answer. Please try again.'
        : 'The assistant is unavailable right now. Please try again in a moment.',
    });
  }
  if (!reply) {
    return res.status(502).json({
      success: false,
      code: 'ASSISTANT_UNAVAILABLE',
      message: 'The assistant did not answer. Please try again.',
    });
  }
  // Nothing from the conversation is saved on the server.
  res.json({ success: true, reply });
});
