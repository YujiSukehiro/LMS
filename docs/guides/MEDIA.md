# How To media (videos and screenshots)

The How To page (`/how-to`) shows the written guides from `src/lib/guides/`. When media is published it also shows a click-to-play narrated video per role, a **Watch (m:ss)** button per section, and a **Show screenshots** toggle per section. Without media, the page is text only and still complete.

## What lives where

| What | Where | In git? |
| --- | --- | --- |
| Recorded videos + chapter timing | `docs/guides/videos/<role>.mp4`, `<role>.chapters.json` | No (gitignored) |
| Chapter start per guide section | `src/lib/guides/media-chapters.generated.ts` | Yes (generated) |
| Files the app serves locally | `public/guide-media/` (`manifest.json`, hashed `.mp4` and `.webp`) | No (gitignored) |
| Files the app serves in production | Firebase Storage `guide-media/`, through `/api/guide-media` (signed-in users only) | No |

The app reads one setting, `NEXT_PUBLIC_GUIDE_MEDIA_BASE_URL`:

- unset: `/guide-media` (local `public/guide-media/`)
- `/api/guide-media`: the signed-in-only proxy in front of Storage `guide-media/` (production)

It only shows what `manifest.json` at that base lists.

## Update the media

1. Record the videos (local app and emulators only). This writes `docs/guides/videos/<role>.mp4` and `<role>.chapters.json`. Each chapter lists the guide section ids it covers.
2. Run `npm run guides:media`. It:
   - writes `media-chapters.generated.ts`;
   - copies the videos into `public/guide-media/`;
   - extracts a poster and 2 WebP screenshots (about 1000 px) per chapter from the recordings;
   - writes `manifest.json`.
   It needs ffmpeg.
3. Commit `media-chapters.generated.ts` (never edit it by hand). Run the guide tests: they check that every timed section exists.
4. Production only, with the owner's go-ahead:
   - `npm run guides:media:upload -- --project=<id> --bucket=<bucket> --yes` uploads to Storage `guide-media/`. Content-hashed files get a one-year immutable cache and the manifest gets 5 minutes.
   - Set `NEXT_PUBLIC_GUIDE_MEDIA_BASE_URL=/api/guide-media` in `apphosting.yaml`.
   - Deploy `storage.rules`.

## Deep links

`/how-to?role=trainer#publish-assign` opens the Trainer tab, scrolls to the section and highlights it. Add `&play=1` to also open the player at that section's chapter. Section ids are explicit in the guide data, so they stay the same when a title changes. `/guide` redirects to `/how-to`.
