import type { GuideLink, RoleGuide } from './types';

/** Readable form of an app path for documents outside the app (":uid" has no meaning there). */
function linkText(link: GuideLink): string {
  if (link.href.includes(':uid')) return `**${link.label}**`;
  return `**${link.label}** (\`${link.href}\`)`;
}

/**
 * One role's guide as Markdown, generated from the same data the Guide page shows. Written to docs/guides/ by
 * `npm run guides:export`; a unit test fails when the committed files drift from the data.
 */
export function guideToMarkdown(guide: RoleGuide): string {
  const lines: string[] = [];
  lines.push(`# ${guide.title}`, '', guide.intro, '');
  lines.push('> Generated from `src/lib/guides/`. Do not edit by hand: change the guide data and run `npm run guides:export`.', '');
  lines.push('## Contents', '');
  for (const chapter of guide.chapters) {
    lines.push(`- ${chapter.title}`);
    for (const section of chapter.sections) lines.push(`  - [${section.title}](#${section.id})`);
  }
  lines.push('');
  for (const chapter of guide.chapters) {
    lines.push(`## ${chapter.title}`, '');
    for (const section of chapter.sections) {
      lines.push(`<a id="${section.id}"></a>`, '', `### ${section.title}`, '');
      lines.push(`**What it is.** ${section.what}`, '');
      lines.push(`**When to use it.** ${section.when}`, '');
      if (section.steps.length > 0) {
        lines.push('**How to:**', '');
        section.steps.forEach((step, index) => lines.push(`${index + 1}. ${step}`));
        lines.push('');
      }
      if (section.tips && section.tips.length > 0) {
        lines.push('**Tips:**', '');
        for (const tip of section.tips) lines.push(`- ${tip}`);
        lines.push('');
      }
      if (section.links && section.links.length > 0) {
        lines.push(`**Open in Pulse:** ${section.links.map(linkText).join(' · ')}`, '');
      }
    }
  }
  return `${lines.join('\n').trimEnd()}\n`;
}

/** File name in docs/guides/ for a guide, e.g. "agent-guide.md". */
export function guideFileName(guide: RoleGuide): string {
  return `${guide.role.toLowerCase()}-guide.md`;
}
