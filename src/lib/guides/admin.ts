import type { RoleGuide } from './types';
import { accountMenuSection, forgotPasswordSection, signInSection, myTrainingsSection } from './shared';
import { cohortsSection, editAccessSection, joinCodesSection, whoSeesTrackSection } from './cohort-sections';
import {
  aiStatusSection,
  bulkImportSection,
  deactivateSection,
  inviteSection,
  resetPasswordSection,
  staffPageSection,
  rosterSection,
} from './staff-sections';
import { BUILDING_CHAPTER, TEAM_CHAPTER, seeAlsoSections } from './trainer';

export const ADMIN_GUIDE: RoleGuide = {
  role: 'ADMIN',
  label: 'Admin',
  title: 'Admin guide',
  intro:
    'You can do everything a Trainer does, and you also run Cohorts, join codes and Trainer accounts. Super Admins use this guide too; they can also manage Admins.',
  chapters: [
    {
      id: 'getting-started',
      title: 'Getting started',
      sections: [
        signInSection('staff'),
        forgotPasswordSection('staff'),
        myTrainingsSection('internal'),
        {
          id: 'home',
          title: 'Your Home page',
          what: 'Operations readiness across every Division and Cohort: certifications, Checkpoint completions, practice pass rate, a card per Division, and a Cohort leaderboard.',
          when: 'For a quick health check of the whole operation.',
          steps: [
            'Select a Division card to open Analytics filtered to it.',
            'Select a Cohort in **Cohort leaderboard** to open its Analytics.',
            'Use **Track Studio**, **Roster** and **Analytics** at the top for the main admin pages.',
          ],
          links: [{ label: 'Go to Home', href: '/' }],
        },
      ],
    },
    {
      id: 'cohorts-and-people',
      title: 'Cohorts and people',
      sections: [
        rosterSection('admin'),
        cohortsSection,
        joinCodesSection,
        inviteSection('admin'),
        bulkImportSection,
        editAccessSection('admin'),
        staffPageSection('admin'),
        resetPasswordSection('admin'),
        deactivateSection('admin'),
        whoSeesTrackSection('staff'),
        {
          id: 'roles-permissions',
          title: 'Roles and permissions',
          what: 'Five roles, from most to least access: Super Admin, Admin, Trainer, Partner Supervisor, Agent. Each role manages only roles below it; nobody edits their own access.',
          when: 'When deciding what role to give someone, or why a button is greyed out.',
          steps: [
            'On the **Roster**, open **Roles & permissions** to see the full table.',
            'To make someone an Admin, ask a Super Admin.',
          ],
          tips: [
            'Trainers can invite Trainers, Partner Supervisors and Agents, and manage supervisors and agents. Only Admins manage Trainers and Cohorts.',
            'Partner Supervisors see only their own Cohort and can only reset passwords for its active agents.',
            'Anyone signing in with a new @logicall.io or @logicall.live Google account starts as an Agent in the Internal Cohort. Change their role with **Access**.',
          ],
          links: [{ label: 'Open Roster', href: '/roster' }],
          requires: ['roster.view'],
        },
      ],
    },
    BUILDING_CHAPTER,
    TEAM_CHAPTER,
    {
      id: 'more',
      title: 'More',
      sections: [...seeAlsoSections(['trainer', 'supervisor']), aiStatusSection, accountMenuSection],
    },
  ],
};
