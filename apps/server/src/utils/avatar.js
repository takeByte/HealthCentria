import { z } from 'zod';

/**
 * Avatars are stored inline as data URLs. The web app downsizes photos to
 * 256×256 JPEG before uploading, so this cap only guards against a crafted
 * request bloating the user document.
 */
export const AVATAR_MAX_LENGTH = 400_000;

const DATA_URL = /^data:image\/(?:png|jpe?g|webp);base64,[A-Za-z0-9+/=]+$/;

/** Empty string clears the photo; otherwise it must be a small image data URL. */
export const avatarSchema = z
  .string()
  .trim()
  .max(AVATAR_MAX_LENGTH, 'That image is too large.')
  .refine((value) => value === '' || DATA_URL.test(value), 'Choose a valid image.');
