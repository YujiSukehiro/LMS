'use client';

import Link from 'next/link';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { ArrowRight, BookOpen, Check, ChevronDown, Images, Lightbulb, Link2, ListOrdered, Play, Search, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { GUIDES } from '@/lib/guides';
import { guideHref, guideRoleParam } from '@/lib/guides/access';
import {
  VIDEO_FOR_GUIDE,
  formatClock,
  guideMediaUrl,
  screenshotKey,
  sectionMedia,
  type GuideMediaManifest,
  type VideoRole,
} from '@/lib/guides/media';
import { filterGuide } from '@/lib/guides/search';
import type { GuideChapter, GuideRoleId, GuideSection } from '@/lib/guides/types';
import { GuideText } from './guide-text';
import { markGuideSeen } from './guide-banner-cookie';

const VIDEO_LABEL: Record<VideoRole, string> = { agent: 'Agent', supervisor: 'Supervisor', trainer: 'Trainer', admin: 'Admin' };

function resolveHref(href: string, uid: string): string {
  return href.replace(':uid', encodeURIComponent(uid));
}

/** What the player shows: which video and where to start. Null until someone asks for it. */
interface PlayerRequest {
  video: VideoRole;
  start: number;
  /** Bumped on every request so the same chapter can be replayed. */
  nonce: number;
  /** Try to start playback (a click, or ?play=1). */
  autoplay: boolean;
}

export function HowToView({
  uid,
  roles,
  initialRole,
  manifest,
  mediaBase,
}: {
  uid: string;
  /** Guides this reader may open, own guide first. */
  roles: GuideRoleId[];
  initialRole: GuideRoleId;
  /** Published media, or null when there is none (text only). */
  manifest: GuideMediaManifest | null;
  mediaBase: string;
}) {
  const [active, setActive] = useState<GuideRoleId>(initialRole);
  const [query, setQuery] = useState('');
  const [player, setPlayer] = useState<PlayerRequest | null>(null);
  const [highlight, setHighlight] = useState<string | null>(null);
  const searchId = useId();
  const playerRef = useRef<HTMLDivElement>(null);
  const guide = GUIDES[active];
  const chapters = useMemo(() => filterGuide(guide, query), [guide, query]);
  const matchCount = chapters.reduce((sum, chapter) => sum + chapter.sections.length, 0);
  const tabVideo = VIDEO_FOR_GUIDE[active];
  const hasVideo = (video: VideoRole) => Boolean(manifest?.videos[video]);

  const openPlayer = useCallback(
    (video: VideoRole, start: number, autoplay: boolean) => {
      if (!manifest?.videos[video]) return;
      setPlayer((prev) => ({ video, start, autoplay, nonce: (prev?.nonce ?? 0) + 1 }));
      requestAnimationFrame(() => playerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    },
    [manifest],
  );

  // Opening How To counts as reading it: the "New here?" banner stops showing.
  useEffect(() => {
    markGuideSeen(uid);
  }, [uid]);

  // Deep links: /how-to?role=x#section scrolls to and highlights the section; &play=1 opens the player there.
  useEffect(() => {
    function goToHash(fromLoad: boolean) {
      const id = decodeURIComponent(window.location.hash.slice(1));
      if (!id) return;
      const el = document.getElementById(id);
      if (!el) return;
      el.scrollIntoView({ behavior: fromLoad ? 'auto' : 'smooth', block: 'start' });
      setHighlight(id);
      window.setTimeout(() => setHighlight((current) => (current === id ? null : current)), 2600);
      if (fromLoad && new URLSearchParams(window.location.search).get('play') === '1') {
        const media = sectionMedia(initialRole, id);
        if (media) openPlayer(media.video, media.start, true);
      }
    }
    goToHash(true);
    const onHash = () => goToHash(false);
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, [initialRole, openPlayer]);

  function chooseRole(role: GuideRoleId) {
    setActive(role);
    setPlayer(null);
    const url = new URL(window.location.href);
    url.searchParams.set('role', guideRoleParam(role));
    url.searchParams.delete('play');
    url.hash = '';
    window.history.replaceState(null, '', url);
    window.scrollTo({ top: 0 });
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <p className="pulse-label flex items-center gap-1.5">
          <BookOpen aria-hidden className="size-3.5 text-pulse-indigo" />
          How To
        </p>
        <h1 className="text-xl font-bold tracking-tight sm:text-2xl">{guide.title}</h1>
        <p className="max-w-3xl text-sm text-pulse-muted">{guide.intro}</p>
      </div>

      {roles.length > 1 ? (
        <div role="tablist" aria-label="Guides by role" className="flex flex-wrap gap-1 border-b border-pulse-border-subtle">
          {roles.map((role, index) => {
            const selected = role === active;
            return (
              <button
                key={role}
                type="button"
                role="tab"
                id={`guide-tab-${role}`}
                aria-selected={selected}
                aria-controls="guide-panel"
                onClick={() => chooseRole(role)}
                className={cn(
                  '-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors',
                  selected ? 'border-pulse-indigo text-pulse-primary' : 'border-transparent text-pulse-muted hover:text-pulse-secondary',
                )}
              >
                {GUIDES[role].label}
                {index === 0 ? <span className="ml-1.5 text-xs font-normal text-pulse-muted">(you)</span> : null}
              </button>
            );
          })}
        </div>
      ) : null}

      <div
        id="guide-panel"
        role={roles.length > 1 ? 'tabpanel' : undefined}
        aria-labelledby={roles.length > 1 ? `guide-tab-${active}` : undefined}
        className="grid gap-5 lg:grid-cols-[15rem_minmax(0,1fr)] xl:grid-cols-[17rem_minmax(0,1fr)]"
      >
        <aside className="flex min-w-0 flex-col gap-3 lg:sticky lg:top-20 lg:max-h-[calc(100vh-6rem)] lg:self-start lg:overflow-y-auto">
          <div className="relative">
            <label htmlFor={searchId} className="sr-only">
              Search this guide
            </label>
            <Search aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-pulse-muted" />
            <input
              id={searchId}
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search this guide"
              className="pulse-input w-full pl-8 pr-8"
              autoComplete="off"
            />
            {query ? (
              <button
                type="button"
                onClick={() => setQuery('')}
                aria-label="Clear search"
                className="absolute right-1.5 top-1/2 grid size-6 -translate-y-1/2 place-items-center rounded-pulse-sm text-pulse-muted hover:text-pulse-primary"
              >
                <X aria-hidden className="size-3.5" />
              </button>
            ) : null}
          </div>
          {query ? (
            <p role="status" className="text-xs text-pulse-muted">
              {matchCount === 0 ? 'No sections match.' : `${matchCount} section${matchCount === 1 ? '' : 's'} match.`}
            </p>
          ) : null}
          <JumpLinks chapters={chapters} />
        </aside>

        <div className="flex min-w-0 flex-col gap-6">
          {hasVideo(tabVideo) || (player && hasVideo(player.video)) ? (
            <div ref={playerRef} className="scroll-mt-20">
              <VideoPlayer
                manifest={manifest!}
                mediaBase={mediaBase}
                defaultVideo={tabVideo}
                request={player}
                onStart={() => openPlayer(player?.video ?? tabVideo, player?.start ?? 0, true)}
              />
            </div>
          ) : null}
          {chapters.length === 0 ? (
            <div className="rounded-pulse-lg border border-dashed border-pulse-border px-6 py-10 text-center">
              <p className="text-sm font-semibold text-pulse-secondary">Nothing in this guide matches “{query}”.</p>
              <p className="mt-1 text-sm text-pulse-muted">Try a shorter word, or check another role&apos;s guide.</p>
            </div>
          ) : (
            chapters.map((chapter) => (
              <section key={chapter.id} aria-labelledby={`chapter-${chapter.id}`} className="flex flex-col gap-3">
                <h2 id={`chapter-${chapter.id}`} className="pulse-label">
                  {chapter.title}
                </h2>
                {chapter.sections.map((section) => {
                  const media = sectionMedia(active, section.id);
                  return (
                    <SectionCard
                      key={section.id}
                      role={active}
                      section={section}
                      uid={uid}
                      highlighted={highlight === section.id}
                      watch={media && hasVideo(media.video) ? { ...media, onWatch: () => openPlayer(media.video, media.start, true) } : null}
                      screenshots={(manifest?.screenshots[screenshotKey(active, section.id)] ?? []).map((file) => guideMediaUrl(file, mediaBase))}
                    />
                  );
                })}
              </section>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Click-to-play. Until someone selects Play (here or on a section's Watch button) there is no <video> and no
 * poster request: the page loads nothing heavy. After that: preload="metadata", the poster, native controls.
 */
function VideoPlayer({
  manifest,
  mediaBase,
  defaultVideo,
  request,
  onStart,
}: {
  manifest: GuideMediaManifest;
  mediaBase: string;
  defaultVideo: VideoRole;
  request: PlayerRequest | null;
  onStart: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const video = request?.video ?? defaultVideo;
  const entry = manifest.videos[video];

  useEffect(() => {
    const el = videoRef.current;
    if (!el || !request) return;
    const seek = () => {
      el.currentTime = request.start;
      if (request.autoplay) void el.play().catch(() => undefined);
    };
    if (el.readyState >= 1) seek();
    else el.addEventListener('loadedmetadata', seek, { once: true });
  }, [request]);

  if (!entry) return null;
  return (
    <section aria-label={`${VIDEO_LABEL[video]} video`} className="pulse-card overflow-hidden">
      {request ? (
        <video
          key={entry.file}
          ref={videoRef}
          className="aspect-[16/10] w-full bg-black"
          controls
          playsInline
          preload="metadata"
          poster={guideMediaUrl(entry.poster, mediaBase)}
          src={guideMediaUrl(entry.file, mediaBase)}
        >
          Your browser cannot play this video.
        </video>
      ) : (
        <button
          type="button"
          onClick={onStart}
          className="group flex aspect-[16/7] w-full flex-col items-center justify-center gap-3 bg-gradient-to-br from-pulse-indigo/15 via-pulse-surface-2 to-pulse-surface-1 text-center"
        >
          <span className="grid size-14 place-items-center rounded-full bg-pulse-indigo text-pulse-on-accent shadow-lg transition-transform group-hover:scale-105">
            <Play aria-hidden className="ml-0.5 size-6" />
          </span>
          <span className="text-base font-semibold">Watch the {VIDEO_LABEL[video]} video</span>
          <span className="pulse-metric text-xs text-pulse-muted">{formatClock(entry.duration)} · narrated · every feature in order</span>
        </button>
      )}
      <p className="flex items-center justify-between gap-2 border-t border-pulse-border-subtle px-3 py-2 text-xs text-pulse-muted">
        <span>{VIDEO_LABEL[video]} video{request ? ` · from ${formatClock(request.start)}` : ''}</span>
        <span>Each section&apos;s Watch button jumps to its part.</span>
      </p>
    </section>
  );
}

function JumpLinks({ chapters }: { chapters: GuideChapter[] }) {
  const list = (
    <ul className="flex flex-col gap-3">
      {chapters.map((chapter) => (
        <li key={chapter.id}>
          <p className="pulse-label px-2 pb-1">{chapter.title}</p>
          <ul className="flex flex-col">
            {chapter.sections.map((section) => (
              <li key={section.id}>
                <a
                  href={`#${section.id}`}
                  className="block rounded-pulse-sm px-2 py-1 text-sm text-pulse-secondary hover:bg-pulse-surface-2 hover:text-pulse-primary"
                >
                  {section.title}
                </a>
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ul>
  );
  if (chapters.length === 0) return null;
  return (
    <nav aria-label="Jump to a section">
      {/* Phones and tablets: collapsed so the guide starts above the fold. */}
      <details className="pulse-card px-3 py-2 lg:hidden">
        <summary className="cursor-pointer text-sm font-semibold">Jump to a section</summary>
        <div className="pt-2">{list}</div>
      </details>
      <div className="hidden lg:block">{list}</div>
    </nav>
  );
}

function CopyLinkButton({ role, sectionId, title }: { role: GuideRoleId; sectionId: string; title: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    const url = `${window.location.origin}${guideHref(role, sectionId)}`;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      window.history.replaceState(null, '', guideHref(role, sectionId));
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }
  return (
    <button
      type="button"
      onClick={() => void copy()}
      aria-label={copied ? `Link to ${title} copied` : `Copy link to ${title}`}
      title={copied ? 'Link copied' : 'Copy link to this section'}
      className="grid size-7 shrink-0 place-items-center rounded-pulse-sm text-pulse-muted hover:bg-pulse-surface-2 hover:text-pulse-primary"
    >
      {copied ? <Check aria-hidden className="size-3.5 text-pulse-emerald" /> : <Link2 aria-hidden className="size-3.5" />}
    </button>
  );
}

function SectionCard({
  role,
  section,
  uid,
  highlighted,
  watch,
  screenshots,
}: {
  role: GuideRoleId;
  section: GuideSection;
  uid: string;
  highlighted: boolean;
  watch: { start: number; onWatch: () => void } | null;
  screenshots: string[];
}) {
  const [shotsOpen, setShotsOpen] = useState(false);
  const shotsId = useId();
  return (
    <article
      id={section.id}
      className={cn(
        'pulse-card scroll-mt-20 flex flex-col gap-3 p-4 transition-shadow duration-500 md:p-5',
        highlighted && 'ring-2 ring-pulse-indigo ring-offset-2 ring-offset-pulse-bg',
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="min-w-0 flex-1 text-base font-semibold tracking-tight">{section.title}</h3>
        {watch ? (
          <button type="button" onClick={watch.onWatch} className="pulse-btn px-2 py-1 text-xs">
            <Play aria-hidden className="size-3.5" />
            Watch ({formatClock(watch.start)})
          </button>
        ) : null}
        <CopyLinkButton role={role} sectionId={section.id} title={section.title} />
      </div>
      <dl className="grid gap-2 text-sm sm:grid-cols-2 sm:gap-4">
        <div>
          <dt className="pulse-label">What it is</dt>
          <dd className="mt-0.5 text-pulse-secondary">
            <GuideText text={section.what} />
          </dd>
        </div>
        <div>
          <dt className="pulse-label">When to use it</dt>
          <dd className="mt-0.5 text-pulse-secondary">
            <GuideText text={section.when} />
          </dd>
        </div>
      </dl>
      {section.steps.length > 0 ? (
        <div>
          <p className="pulse-label flex items-center gap-1.5">
            <ListOrdered aria-hidden className="size-3.5" />
            How to
          </p>
          <ol className="mt-1.5 flex flex-col gap-1.5 text-sm">
            {section.steps.map((step, index) => (
              <li key={index} className="flex gap-2.5">
                <span
                  aria-hidden
                  className="pulse-metric mt-px grid size-5 shrink-0 place-items-center rounded-full bg-pulse-indigo/12 text-[0.7rem] font-semibold text-pulse-indigo-text"
                >
                  {index + 1}
                </span>
                <span className="min-w-0 text-pulse-secondary">
                  <GuideText text={step} />
                </span>
              </li>
            ))}
          </ol>
        </div>
      ) : null}
      {section.tips && section.tips.length > 0 ? (
        <div className="rounded-pulse-md border border-pulse-border-subtle bg-pulse-surface-2/60 px-3 py-2.5">
          <p className="pulse-label flex items-center gap-1.5">
            <Lightbulb aria-hidden className="size-3.5 text-pulse-amber" />
            Tips
          </p>
          <ul className="mt-1 flex list-disc flex-col gap-1 pl-5 text-sm text-pulse-secondary">
            {section.tips.map((tip, index) => (
              <li key={index}>
                <GuideText text={tip} />
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {screenshots.length > 0 ? (
        <div>
          <button
            type="button"
            aria-expanded={shotsOpen}
            aria-controls={shotsId}
            onClick={() => setShotsOpen((open) => !open)}
            className="flex items-center gap-1.5 text-sm font-medium text-pulse-indigo-text hover:underline"
          >
            <Images aria-hidden className="size-4" />
            {shotsOpen ? 'Hide screenshots' : `Show screenshots (${screenshots.length})`}
            <ChevronDown aria-hidden className={cn('size-4 transition-transform', shotsOpen && 'rotate-180')} />
          </button>
          {/* Not in the DOM until opened, so nothing downloads for readers who never look. */}
          {shotsOpen ? (
            <div id={shotsId} className="mt-2 grid gap-2 sm:grid-cols-2">
              {screenshots.map((src, index) => (
                // eslint-disable-next-line @next/next/no-img-element -- media from a configurable host, already sized WebP.
                <img
                  key={src}
                  src={src}
                  alt={`${section.title}, screenshot ${index + 1} of ${screenshots.length}`}
                  loading="lazy"
                  decoding="async"
                  width={1000}
                  height={625}
                  className="h-auto w-full rounded-pulse-md border border-pulse-border-subtle"
                />
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
      {section.links && section.links.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {section.links.map((link) => (
            <Link key={link.href + link.label} href={resolveHref(link.href, uid)} className="pulse-btn text-xs">
              {link.label}
              <ArrowRight aria-hidden className="size-3.5" />
            </Link>
          ))}
        </div>
      ) : null}
    </article>
  );
}
