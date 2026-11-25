/**
 * Everything about Cohorts, Cohort membership and assigning Tracks lives in this one file, so a change to how
 * assignment works is a change here. After editing, run `npm run guides:export`.
 *
 * Model (PR #19, 2026-11-24): a person has one home Cohort (decides who supervises them and where Team Progress
 * shows them) plus optional extra Cohorts ("Also in these Cohorts"). A Track reaches someone when it is assigned to
 * every Cohort, to any of their Cohorts, or to them by name, and they have the Track's Division.
 */
import type { GuideSection } from './types';

/** Who sees a Track. Same rule for every staff guide; the supervisor version drops the "you can change it" steps. */
export const whoSeesTrackSection = (audience: 'supervisor' | 'staff'): GuideSection => ({
  id: 'who-sees-a-track',
  title: 'Who sees which Track',
  what: 'An agent sees a published Track when it is assigned to every Cohort, to any of their Cohorts (their home Cohort or one they are also in), or to them by name, and they have the Track\'s Division, for example Telehealth.',
  when:
    audience === 'supervisor'
      ? 'When an agent says a Track is missing, or Team Progress shows "Not assigned" for someone.'
      : 'Before you publish, and when an agent says a Track is missing.',
  steps:
    audience === 'supervisor'
      ? [
          'Open the agent\'s Readiness Passport and check their Cohort and Division pills.',
          'If the Division is wrong, or the agent should also be in another Cohort, ask your LogiCall Trainer or Admin. They change it with **Access** on the Roster.',
          'If the Track is not assigned to your Cohort or to the agent, ask your Trainer to assign it.',
        ]
      : [
          'On the Roster, check the agent\'s **Cohort** and **Divisions** columns. Select **Access** to see the Cohorts they are also in.',
          'Wrong Division, or they should also be in another team\'s Cohort: fix it with **Access** (see "Change role, Cohort and Divisions").',
          'Track not assigned to them: assign it from the Cohort card (**Trainings**) or from the Track (**Publish & Assign**). See "Assign trainings to Cohorts or people".',
        ],
  tips: [
    'The Division rule always applies: someone assigned by name or through a Cohort still needs the Track\'s Division. A user with no Divisions sees no Tracks.',
    'On Team Progress and Analytics, a Track the agent cannot see shows as "Not assigned" for them.',
    'Changes to Cohorts, Divisions and assignments apply straight away. Nobody has to sign out.',
  ],
});

export const publishAssignSection: GuideSection = {
  id: 'publish-assign',
  title: 'Publish and assign a Track',
  what: 'Publishing freezes the draft as a new version (v1, v2…) and sets who must take it: Cohorts, specific people, or both. They see it on their Home page if they have the Track\'s Division.',
  when: 'When the Track has been reviewed and test-played, and each time you want learners to get your latest edits.',
  steps: [
    'Open the Track in **Track Studio** and select **Publish & Assign**.',
    'Read **Suggested review before going live**. It is advice only: you can still publish.',
    'Under **Target Cohorts**, tick each Cohort that must take the Track, or tick **Every Cohort, including ones added later**.',
    'To add one person (for example someone outside those Cohorts), type their name or LC Number under **Specific people** and tick them.',
    'Check the total ("Reaches N agents in the Cohorts, plus N named people.") and select **Publish Track**.',
    'On **Published as TrackVersion vN**, select **Copy** to share the Track link, then **Done**.',
  ],
  tips: [
    'Only real problems block publishing (for example a claim the Playbook does not support, or a thin Checkpoint). They are listed with an **Open Source Review** button. Evidence sign-off is a suggestion, not a blocker.',
    'Already published and only changing who takes it? Select **Save assignment only**. No new version is made and agents keep the same content.',
    'Every Cohort is listed, even one with no agents yet: set a new Cohort up with its trainings first, and people who join it later get them automatically. Only agents with the Track\'s Division appear under **Specific people**.',
    'A republish keeps the current Cohorts and people ticked. Agents keep their progress; only changes to what is assessed send certified agents back to recertify.',
    'The Track\'s Division is set when you create it and cannot be changed later.',
  ],
  links: [{ label: 'Open Track Studio', href: '/studio' }],
  requires: ['tracks.publish'],
};

export const assignTrainingsSection: GuideSection = {
  id: 'assign-trainings',
  title: 'Assign trainings to Cohorts or people',
  what: 'You can assign published trainings from either side: from a Cohort (which trainings this team takes) or from a Track (which Cohorts and people take this training). Both change the same assignment.',
  when: 'From the Cohort when a team starts or changes campaign and needs several trainings at once. From the Track when one training goes to several Cohorts, or to a few named people.',
  steps: [
    'Cohort side: open **Roster**, find the Cohort card and select **Trainings (N)**.',
    'Tick each training this Cohort must take and select **Save trainings**.',
    'Training side: open the Track in **Track Studio** and select **Publish & Assign**.',
    'Tick Cohorts under **Target Cohorts** and add people under **Specific people**, then select **Save assignment only** (or **Publish Track** if you also want to publish your latest draft).',
  ],
  tips: [
    'A Cohort\'s trainings reach everyone in it, including people who are only "also in" that Cohort.',
    'Trainings published to **Every Cohort** show ticked and locked in a Cohort\'s **Trainings** list. Change those from the Track.',
    'Only published trainings can be assigned. Agents still need the training\'s Division to see it.',
  ],
  links: [
    { label: 'Open Roster', href: '/roster' },
    { label: 'Open Track Studio', href: '/studio' },
  ],
  requires: ['tracks.publish'],
};

export const editAccessSection = (audience: 'trainer' | 'admin'): GuideSection => ({
  id: 'edit-access',
  title: 'Change role, Cohort and Divisions',
  what: 'The **Access** button on a Roster row changes a person\'s name, role, home Cohort, the other Cohorts they are also in, and their Divisions. Together these decide which Tracks they see.',
  when: 'When someone moves team, also works for another team, changes campaign, gets promoted, or cannot see a Track they should.',
  steps: [
    'Open **Roster** and find the person (filter by **Cohort** or **Status** if needed).',
    'Select **Access** on their row.',
    'Change **Role**, **Home Cohort** or **Divisions** as needed.',
    'Under **Also in these Cohorts**, tick any other Cohort whose trainings they should also take.',
    'Select **Save access**. A role or home Cohort change ends their old sessions, so they sign in again.',
  ],
  tips: [
    audience === 'trainer'
      ? 'Trainers manage Partner Supervisors and Agents. Other Trainers and Admins show "Higher role".'
      : 'Admins manage Trainers, Partner Supervisors and Agents. Only a Super Admin manages Admins and Super Admins.',
    'Trainer, Admin and Super Admin accounts must stay in the LogiCall Internal Cohort. Move the person to the Internal Cohort first, then change the role.',
    'The home Cohort decides who supervises them and where they show on Team Progress. Extra Cohorts only add trainings.',
    'Nobody can change their own access.',
  ],
  links: [{ label: 'Open Roster', href: '/roster' }],
  requires: ['users.editAccess'],
});

export const cohortsSection: GuideSection = {
  id: 'cohorts',
  title: 'Create, edit and delete Cohorts',
  what: 'A Cohort is one team (a partner BPO or the LogiCall Internal team). Each person has one home Cohort and can also be in others; trainings are assigned to Cohorts. Only Admins create, edit and delete Cohorts.',
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
    'To choose which trainings a Cohort takes, use **Trainings** on its card (see "Assign trainings to Cohorts or people").',
  ],
  links: [{ label: 'Open Roster', href: '/roster' }],
  requires: ['cohorts.create', 'cohorts.edit', 'cohorts.delete'],
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
