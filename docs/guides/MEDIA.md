# How To media (videos, subtitles, screenshots)

The How To page (`/how-to`) shows the written guides from `src/lib/guides/`. When media is published it also shows:

- a click-to-play narrated video per role;
- a **Watch (m:ss)** button on each section;
- a **Show screenshots** toggle on each section.

Without media, the page is text only and still complete.

## Who sees what

- Each reader sees their own role's guide and video open at the top.
- The roles below theirs sit underneath, folded. Their content loads from `/api/how-to/<role>` only when expanded.
- Roles above theirs are never sent: not in the HTML, the page payload, or an API response (403).
  - Admin and Super Admin: Admin, then Trainer, Supervisor and Agent.
  - Trainer: Trainer, then Supervisor and Agent.
  - Supervisor: Supervisor, then Agent.
  - Agent: Agent only.
- Media files sit in role folders (`agent/`, `supervisor/`, `trainer/`, `admin/`). They are served only by `/api/guide-media/<folder>/<file>`, which returns 403 for a folder above the reader's role. Browsers never read media from Storage directly: `storage.rules` denies all client reads and writes.

## What lives where

| What | Where | In git? |
| --- | --- | --- |
| Recorded videos, subtitles and chapter timing | `docs/guides/videos/<role>.mp4`, `<role>.vtt`, `<role>.chapters.json` | No (gitignored) |
| Chapter start per guide section | `src/lib/guides/media-chapters.generated.ts` | Yes (generated) |
| Files the app serves in development | `guide-media/` at the app root (role folders plus `manifest.json`) | No (gitignored, not under `public/`) |
| Files the app serves in production | Firebase Storage `guide-media/`, read by the server with the Admin SDK | No |

`GUIDE_MEDIA_SOURCE` chooses the store: `local` or `storage`. The default is `local` when `guide-media/manifest.json` exists, otherwise `storage`.

## Videos

- 1280×928: the app at 1280×800, with a caption band underneath showing the feature title and the current narration line. The band never covers the app.
- Narration is a local Chatterbox voice (mlx-audio), about 170 words per minute.
  - The TTS input respells names: "Logic-call Pulse" and "L C Number". Captions keep the real spelling.
  - Every clip is checked with local speech-to-text and redone if it is off.
- Nothing plays on page load. Clicking play or a section's **Watch** button plays with sound at 50% volume. The reader's own volume change is kept after that.
- Narration is loudness-normalized to about -16 LUFS so it isn't loud on any device.
- A WebVTT subtitle track is attached for the player's CC button. It is off by default because the text is already in the caption band.

## Update the media

1. Record the videos on the local app and emulators only. This writes `docs/guides/videos/<role>.mp4`, `.vtt` and `.chapters.json`.
2. Run `npm run guides:media`. It:
   - writes `media-chapters.generated.ts`;
   - copies the videos and subtitles into `guide-media/<role>/`;
   - extracts a poster and 2 WebP screenshots (about 1000 px wide) per chapter;
   - writes `manifest.json`.

   It needs ffmpeg.
3. Commit `media-chapters.generated.ts` (never edit it by hand) and run the guide tests.
4. Production only, with the owner's go-ahead:
   - Run `npm run guides:media:upload -- --project=<id> --bucket=<bucket> --yes` to upload to Storage `guide-media/`.
   - Deploy `storage.rules`.

## Deep links

- `/how-to?role=trainer#publish-assign` opens that role's section, scrolls to the section and highlights it.
- Add `&play=1` to open the player at that section's chapter. Browsers may wait for a click before playing, since playback has sound.
- A link to a role above the reader opens the reader's own role instead.
- Section ids are explicit in the guide data, so links survive title edits.
- `/guide` redirects to `/how-to`.
