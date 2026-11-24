/**
 * Everything about Cohorts and assigning Tracks lives in this one file, because the multi-Cohort work (people in
 * several Cohorts; Tracks assigned to Cohorts or to individuals from the Cohort and Track pages) will change it.
 * When that lands, update these sections and every `maintainerNote` below, then run `npm run guides:export`.
 */
import type { GuideSection } from './types';

const MULTI_COHORT_NOTE =
  'Multi-Cohort work (2026-11-24, branch feat/multi-cohort-assignment): rewrite for extra Cohort memberships per user and Tracks assigned to individuals.';

/** Who sees a Track. Same rule for every staff guide; the supervisor version drops the "you can change it" steps. */
export const whoSeesTrackSection = (audience: 'supervisor' | 'staff'): GuideSection => ({
  id: 'who-sees-a-track',
  title: 'Who sees which Track',
  what: 'An agent sees a published Track only when the Track is assigned to their Cohort (or to every Cohort) and the agent has the Track\'s Division, for example Telehealth.',
  when:
    audience === 'supervisor'
      ? 'When an agent says a Track is missing, or Team Progress shows "Not assigned" for someone.'
      : 'Before you publish, and when an agent says a Track is missing.',
  steps:
    audience === 'supervisor'
      ? [
          'Open the agent\'s Readiness Passport and check their Cohort and Division pills.',
          'If the Division or Cohort is wrong, ask your LogiCall Trainer or Admin to fix it. They change it with **Access** on the Roster.',
          'If the Track is not assigned to your Cohort at all, ask your Trainer to add your Cohort when they publish.',
        ]
      : [
          'On the Roster, check the agent\'s **Cohort** and **Divisions** columns.',
          'Fix a wrong Cohort or Division with **Access** (see "Change role, Cohort and Divisions").',
          'Fix a missing Cohort on the Track with **Publish & Assign** (see "Publish and assign a Track").',
        ],
  tips: [
    'A user with no Divisions sees no Tracks.',
    'On Team Progress and Analytics, a Track the agent cannot see shows as "Not assigned" for them.',
    'Changing someone\'s Divisions changes which Tracks they see and are counted on, straight away.',
  ],
  maintainerNote: MULTI_COHORT_NOTE,
});

export const publishAssignSection: GuideSection = {
  id: 'publish-assign',
  title: 'Publish and assign a Track',
  what: 'Publishing freezes the draft as a new version (v1, v2…) and assigns it to Cohorts. Agents in those Cohorts who have the Track\'s Division see it on their Home page.',
  when: 'When the Track has been reviewed and test-played, and each time you want learners to get your latest edits.',
  steps: [
    'Open the Track in **Track Studio** and select **Publish & Assign**.',
    'Read **Suggested review before going live**. It is advice only: you can still publish.',
    'Under **Target Cohorts**, tick each Cohort that must take the Track, or tick **Every Cohort, including ones added later**.',
    'Check the total ("Reaches N agents.") and select **Publish Track**.',
    'On **Published as TrackVersion vN**, select **Copy** to share the Track link, then **Done**.',
  ],
  tips: [
    'Only real problems block publishing (for example a claim the Playbook does not support, or a thin Checkpoint). They are listed with an **Open Source Review** button. Evidence sign-off is a suggestion, not a blocker.',
    'Cohorts with no agents in the Track\'s Division are hidden from the list.',
    'A republish keeps the current Cohorts ticked. Agents keep their progress; only changes to what is assessed send certified agents back to recertify.',
    'The Track\'s Division is set when you create it and cannot be changed later.',
  ],
  links: [{ label: 'Open Track Studio', href: '/studio' }],
  requires: ['tracks.publish'],
  maintainerNote: `${MULTI_COHORT_NOTE} Add the new "assign to individuals" step and any assignment controls on the Track page.`,
};

export const editAccessSection = (audience: 'trainer' | 'admin'): GuideSection => ({
  id: 'edit-access',
  title: 'Change role, Cohort and Divisions',
  what: 'The **Access** button on a Roster row changes a person\'s name, role, Cohort and Divisions. Their Cohort and Divisions decide which Tracks they see.',
  when: 'When someone moves team, changes campaign, gets promoted, or cannot see a Track they should.',
  steps: [
    'Open **Roster** and find the person (filter by **Cohort** or **Status** if needed).',
    'Select **Access** on their row.',
    'Change **Role**, **Cohort** or **Divisions** as needed.',
    'Select **Save access**. Their old sessions end, so they sign in again.',
  ],
  tips: [
    audience === 'trainer'
      ? 'Trainers manage Partner Supervisors and Agents. Other Trainers and Admins show "Higher role".'
      : 'Admins manage Trainers, Partner Supervisors and Agents. Only a Super Admin manages Admins and Super Admins.',
    'Trainer, Admin and Super Admin accounts must stay in the LogiCall Internal Cohort. Move the person to the Internal Cohort first, then change the role.',
    'Nobody can change their own access.',
  ],
  links: [{ label: 'Open Roster', href: '/roster' }],
  requires: ['users.editAccess'],
  maintainerNote: `${MULTI_COHORT_NOTE} The Access dialog will gain extra Cohort memberships.`,
});

export const cohortsSection: GuideSection = {
  id: 'cohorts',
  title: 'Create, edit and delete Cohorts',
  what: 'A Cohort is one team (a partner BPO or the LogiCall Internal team). People belong to one Cohort, and Tracks are assigned to Cohorts. Only Admins manage Cohorts.',
  when: 'When a new partner team starts, a team is renamed or changes Divisions, or a team closes.',
  steps: [
    'Open **Roster**. Cohorts are listed at the top.',
    'New team: select **New Cohort**, type a **Cohort ID** (for example BPO_EAST), a **Display name**, pick **Default divisions**, and select **Create Cohort**. Tick the join-link box if agents will self-register.',
    'Edit: select the pencil icon on the Cohort card, change the name or Divisions, and select **Save**. The Cohort ID never changes.',
    'Delete: first move everyone out with **Access** and revoke its pending invites. Then select the trash icon, type the Cohort ID and select **Delete Cohort**.',
  ],
  tips: [
    'No Cohorts yet? **Initialize 8 Default Cohorts** creates the standard set.',
    'You cannot delete a Cohort that still has users (including deactivated ones), pending invites, or a Track assigned only to it. The Internal Cohort can never be deleted.',
    'Trainers, Admins and Super Admins must be in the Internal Cohort.',
  ],
  links: [{ label: 'Open Roster', href: '/roster' }],
  requires: ['cohorts.create', 'cohorts.edit', 'cohorts.delete'],
  maintainerNote: `${MULTI_COHORT_NOTE} Cohort cards may gain member and Track assignment controls.`,
};

export const joinCodesSection: GuideSection = {
  id: 'join-codes',
  title: 'Cohort join codes',
  what: 'A join code (for example THS-7842) lets LC Number agents create their own account in a partner Cohort. Internal Cohorts are invite-only and never have a code.',
  when: 'When a partner onboards a group of agents and you do not want to import them one by one.',
  steps: [
    'On the **Roster**, find the Cohort card.',
    'Select **Copy join link** and send it to the partner supervisor, or read them the code.',
    'Agents open the link (or select **Have a Team Join Code? Claim Access** on the sign-in page), then fill in their name, LC Number and password.',
    'If a code leaks, select **Rotate code**. The old code stops working; agents who already joined keep their accounts.',
    'To stop self-registration, select **Disable join**. **Enable join** turns it back on.',
  ],
  tips: ['Agents who join with a code become Agents in that Cohort with its default Divisions. Check them on the Roster afterwards.'],
  links: [{ label: 'Open Roster', href: '/roster' }],
  requires: ['cohorts.edit'],
};
