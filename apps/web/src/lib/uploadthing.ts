import { genUploader } from 'uploadthing/client';
import type { FileRouter } from 'uploadthing/types';
import { getSession } from './auth';

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:5000';

// The file router lives in the API package; only the endpoint name is shared.
type UploadRouter = { announcementImage: FileRouter[string] };

const { uploadFiles } = genUploader<UploadRouter>({
  url: `${API_URL}/api/uploadthing`,
  package: 'uploadthing',
});

export interface UploadedImage {
  url: string;
  key: string;
}

/** Uploads announcement images straight to UploadThing with the user's session. */
export async function uploadAnnouncementImages(
  files: File[],
  onProgress?: (percent: number) => void,
): Promise<UploadedImage[]> {
  const token = getSession()?.token;
  const result = await uploadFiles('announcementImage', {
    files,
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    onUploadProgress: ({ totalProgress }) => onProgress?.(Math.round(totalProgress)),
  });
  return result.map((f) => ({ url: f.ufsUrl ?? f.url, key: f.key }));
}
