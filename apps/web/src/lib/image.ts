const MAX_DATA_URL_LENGTH = 400_000;

/**
 * Turn a picked photo into a small square JPEG data URL before it leaves the
 * browser. The server stores avatars inline, so shrinking here keeps the user
 * document (and every profile response) small.
 */
export async function fileToAvatarDataUrl(file: File, size = 256): Promise<string> {
  if (!file.type.startsWith('image/')) {
    throw new Error('Choose an image file (JPG, PNG or WebP).');
  }

  const bitmap = await createImageBitmap(file);
  try {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not read that image.');

    // Cover-crop the shorter side so faces keep their proportions.
    const scale = Math.max(size / bitmap.width, size / bitmap.height);
    const width = bitmap.width * scale;
    const height = bitmap.height * scale;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, size, size);
    ctx.drawImage(bitmap, (size - width) / 2, (size - height) / 2, width, height);

    let quality = 0.85;
    let url = canvas.toDataURL('image/jpeg', quality);
    while (url.length > MAX_DATA_URL_LENGTH && quality > 0.4) {
      quality -= 0.15;
      url = canvas.toDataURL('image/jpeg', quality);
    }
    if (url.length > MAX_DATA_URL_LENGTH) {
      throw new Error('That image is too large. Choose a smaller photo.');
    }
    return url;
  } finally {
    bitmap.close();
  }
}
