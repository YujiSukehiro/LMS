import type { GuideChapter, GuideSection, RoleGuide } from './types';
import { accountMenuSection, forgotPasswordSection, signInSection } from './shared';
import { assignTrainingsSection, editAccessSection, publishAssignSection, whoSeesTrackSection } from './cohort-sections';
import {
  aiStatusSection,
  analyticsSection,
  buildTrackSection,
  bulkImportSection,
  deactivateSection,
  editTrackSection,
  inviteSection,
  manualScoringSection,
  revokeCertificationSection,
  passportSection,
  resetPasswordSection,
  revisedPlaybookSection,
  rosterSection,
  sourceReviewSection,
  teamProgressSection,
  trackStudioSection,
} from './staff-sections';

/** Track Studio chapter, shared by the Trainer and Admin guides. */
export const BUILDING_CHAPTER: GuideChapter = {
  id: 'building-trainings',
  title: 'Building trainings',
  sections: [
    trackStudioSection,
    buildTrackSection,
    editTrackSection,
    sourceReviewSection,
    publishAssignSection,
    assignTrainingsSection,
    revisedPlaybookSection,
  ],
};

export const TEAM_CHAPTER: GuideChapter = {
  id: 'team-insight',
  title: 'Progress and coaching',
  sections: [
    teamProgressSection('staff'),
    manualScoringSection,
    analyticsSection('staff'),
    passportSection('staff'),
    revokeCertificationSection,
  ],
};

/** Pointers to the guides of the roles a staff member manages. */
export function seeAlsoSections(roles: Array<'trainer' | 'supervisor'>): GuideSection[] {
  const sections: GuideSection[] = [];
  if (roles.includes('trainer')) {
    sections.push({
      id: 'trainer-experience',
      title: 'What Trainers see',
      what: 'The Trainer guide covers building, publishing and the people tasks Trainers can do.',
      when: 'When onboarding a new Trainer.',
      steps: ['Select the **Trainer** tab at the top of this page.'],
      links: [{ label: 'Open the Trainer guide', href: '/how-to?role=trainer' }],
    });
  }
  sections.push(
    {
      id: 'supervisor-experience',
      title: 'What supervisors see',
      what: 'Partner Supervisors see their own Cohort only: Home, Team Progress, Analytics and Passports, and they can reset passwords for their agents.',
      when: 'When onboarding a partner supervisor or answering their questions.',
      steps: ['Select the **Supervisor** tab at the top of this page.'],
      links: [{ label: 'Open the Supervisor guide', href: '/how-to?role=supervisor' }],
    },
    {
      id: 'agent-experience',
      title: 'What your agents see',
      what: 'The Agent guide walks through the learner side: Checkpoints, Drills, Verbal Practice, certification and Keep-Sharp reviews.',
      when: 'Before you publish, to know what agents will go through, or when answering agent questions.',
      steps: ['Select the **Agent** tab at the top of this page, or test-play a Track with **Play** in Track Studio.'],
      links: [{ label: 'Open the Agent guide', href: '/how-to?role=agent' }],
    },
  );
  return sections;
}

export const TRAINER_GUIDE: RoleGuide = {
  role: 'TRAINER',
  label: 'Trainer',
  title: 'Trainer guide',
  intro:
    'You use Pulse to turn campaign Playbook PDFs into Tracks, publish them to Cohorts, watch who is ready, and look after supervisors and agents. You see every Cohort.',
  chapters: [
    {
      id: 'getting-started',
      title: 'Getting started',
      sections: [
        signInSection('staff'),
        forgotPasswordSection('staff'),
        {
          id: 'home',
          title: 'Your Home page',
          what: 'Home counts your Tracks by status (Drafts, Generating, Published), lists recently updated Tracks and shows the most-missed items across all Cohorts.',
          when: 'At the start of the day, to pick up drafts and spot confusing content.',
          steps: [
            'Select a Track under **Recently updated Tracks** to open it.',
            'Select **New Campaign Track** to build a new one.',
            'Under **Top missed items**, select an item to fix it in Track Studio.',
          ],
          links: [{ label: 'Go to Home', href: '/' }],
        },
      ],
    },
    BUILDING_CHAPTER,
    TEAM_CHAPTER,
    {
      id: 'people',
      title: 'People',
      sections: [
        rosterSection('trainer'),
        inviteSection('trainer'),
        bulkImportSection,
        editAccessSection('trainer'),
        resetPasswordSection('trainer'),
        deactivateSection('trainer'),
        whoSeesTrackSection('staff'),
        {
          id: 'cohorts-admin-only',
          title: 'Cohorts and join codes',
          what: 'Creating, editing and deleting Cohorts, and managing join codes, is for Admins only. You can still choose each Cohort\'s trainings with **Trainings** on its card, and add people to extra Cohorts with **Access**.',
          when: 'When a new partner team needs a Cohort or a join code.',
          steps: ['Ask a LogiCall Admin to create the Cohort or turn on its join code.'],
        },
      ],
    },
    {
      id: 'more',
      title: 'More',
      sections: [...seeAlsoSections(['supervisor']), aiStatusSection, accountMenuSection],
    },
  ],
};
