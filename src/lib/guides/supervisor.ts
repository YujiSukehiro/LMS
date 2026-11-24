import type { RoleGuide } from './types';
import { accountMenuSection, forgotPasswordSection, signInSection } from './shared';
import { whoSeesTrackSection } from './cohort-sections';
import { analyticsSection, passportSection, resetPasswordSection, teamProgressSection } from './staff-sections';

export const SUPERVISOR_GUIDE: RoleGuide = {
  role: 'SUPERVISOR',
  label: 'Supervisor',
  title: 'Supervisor guide',
  intro:
    'You use Pulse to see which agents in your Cohort are ready to take calls, coach the ones who are not, and get locked-out agents back in. You see your own Cohort only.',
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
          what: 'Home is your Cohort at a glance: how many agents are **Ready for calls** (certified on all their Tracks), the practice pass rate, the average skill score, and each agent\'s status on every Track.',
          when: 'At the start of each shift, to see who is ready and who needs help.',
          steps: [
            'Read the four tiles at the top.',
            'In **Agents**, read each agent\'s status chips (one per Track) and **Last activity**.',
            'Select an agent\'s name to open their Readiness Passport.',
            'Select **Open Cohort Analytics** for skill strengths and the most-missed Drills.',
          ],
          tips: ['Agents who left are hidden. Select **Show offboarded** to see them.'],
          links: [{ label: 'Go to Home', href: '/' }],
        },
      ],
    },
    {
      id: 'your-team',
      title: 'Your team',
      sections: [
        teamProgressSection('supervisor'),
        analyticsSection('supervisor'),
        passportSection('supervisor'),
        resetPasswordSection('supervisor'),
        {
          id: 'add-agents',
          title: 'Adding or changing agents',
          what: 'Supervisors do not open the Roster. LogiCall Trainers and Admins create accounts, change Cohorts, roles and Divisions, and assign trainings to your Cohort or to single agents.',
          when: 'When new agents start, an agent moves team, or someone leaves.',
          steps: [
            'New agents: ask your LogiCall Trainer or Admin to bulk-import them, or for your Cohort\'s join code, which agents type on the sign-in page under **Have a Team Join Code? Claim Access**.',
            'Moves, wrong Divisions and leavers: send the agent\'s name and LC Number to your LogiCall Trainer or Admin.',
            'A training for one agent only, or for your whole Cohort: ask your Trainer. They can assign it to the Cohort or to the agent by name.',
          ],
          tips: [
            'An agent who joins with a code lands in your Cohort with its default Divisions.',
            'Agents from another team who are only "also in" your Cohort take its trainings, but stay under their own home Cohort and supervisor. They do not appear on your Home or Team Progress.',
          ],
        },
        whoSeesTrackSection('supervisor'),
      ],
    },
    {
      id: 'more',
      title: 'More',
      sections: [
        {
          id: 'agent-experience',
          title: 'What your agents see',
          what: 'The Agent guide explains each step your agents go through: Checkpoints, Drills, Verbal Practice, certification and Keep-Sharp reviews.',
          when: 'Before coaching, or when an agent asks how something works.',
          steps: ['Select the **Agent** tab at the top of this page.'],
          links: [{ label: 'Open the Agent guide', href: '/guide?role=agent' }],
        },
        accountMenuSection,
      ],
    },
  ],
};
