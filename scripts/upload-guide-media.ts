/**
 * Upload guide-media/ (made by `npm run guides:media`) to Firebase Storage `guide-media/`, for the role-checked
 * /api/guide-media route. Then set GUIDE_MEDIA_SOURCE=storage (the default when there is no local folder).
 *
 * This writes to a real project's Storage. It does nothing without both flags:
 *   npm run guides:media:upload -- --project=<firebase-project-id> --bucket=<bucket> --yes
 * Credentials: Application Default Credentials (gcloud auth application-default login) with write access.
 * Files are content-hashed, so they get a one-year immutable cache; manifest.json gets 5 minutes.
 */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { applicationDefault, initializeApp } from 'firebase-admin/app';
import { getStorage } from 'firebase-admin/storage';

const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
const project = arg('project');
const bucketName = arg('bucket');
if (!project || !bucketName || !process.argv.includes('--yes')) {
  console.error('Refusing to upload: pass --project=<id> --bucket=<bucket> --yes. This writes to that project\'s Storage.');
  process.exit(2);
}
if (process.env.FIREBASE_STORAGE_EMULATOR_HOST) {
  console.error('FIREBASE_STORAGE_EMULATOR_HOST is set; unset it to upload to a real bucket.');
  process.exit(2);
}

const SRC = path.join(process.cwd(), 'guide-media');
const TYPES: Record<string, string> = { '.mp4': 'video/mp4', '.webp': 'image/webp', '.vtt': 'text/vtt', '.json': 'application/json' };
const bucket = getStorage(initializeApp({ credential: applicationDefault(), projectId: project, storageBucket: bucketName })).bucket();

const files = readdirSync(SRC, { recursive: true }).map(String).filter((f) => TYPES[path.extname(f)]);
// Upload media first and the manifest last, so the manifest never lists a file that is not there yet.
files.sort((a, b) => Number(a === 'manifest.json') - Number(b === 'manifest.json'));
for (const name of files) {
  const isManifest = name === 'manifest.json';
  await bucket.file(`guide-media/${name}`).save(readFileSync(path.join(SRC, name)), {
    resumable: false,
    contentType: TYPES[path.extname(name)],
    metadata: { cacheControl: isManifest ? 'private, max-age=300' : 'private, max-age=31536000, immutable' },
  });
  console.log(`uploaded guide-media/${name}`);
}
console.log(`Done: ${files.length} files to gs://${bucketName}/guide-media/`);
