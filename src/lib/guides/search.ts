import type { GuideChapter, GuideSection, RoleGuide } from './types';

function sectionText(section: GuideSection): string {
  return [section.title, section.what, section.when, ...section.steps, ...(section.tips ?? []), ...(section.links ?? []).map((l) => l.label)]
    .join(' ')
    .replace(/\*\*/g, '')
    .toLowerCase();
}

/**
 * Chapters with only the sections that match every word of the query (case-insensitive, any field).
 * An empty query returns the guide unchanged; chapters with no matching section are dropped.
 */
export function filterGuide(guide: RoleGuide, query: string): GuideChapter[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return guide.chapters;
  return guide.chapters
    .map((chapter) => ({
      ...chapter,
      sections: chapter.sections.filter((section) => {
        const text = `${chapter.title.toLowerCase()} ${sectionText(section)}`;
        return words.every((word) => text.includes(word));
      }),
    }))
    .filter((chapter) => chapter.sections.length > 0);
}
