/**
 * Sections the Trainer and Admin guides share (Track Studio, team insight, people). Supervisor-only wording lives in
 * supervisor.ts; Cohort and assignment wording lives in cohort-sections.ts.
 */
import type { GuideSection } from './types';

// ---------------------------------------------------------------------------------------------------------------
// Track Studio
// ---------------------------------------------------------------------------------------------------------------

export const trackStudioSection: GuideSection = {
  id: 'track-studio',
  title: 'Track Studio',
  what: 'The list of every Track (one per campaign or topic) with its Division, status (**Generating**, **Build failed**, **Draft**, **Published**), published version and size.',
  when: 'To find a Track to test-play, edit or publish, or to start a new one.',
  steps: [
    'Select **Track Studio** in the sidebar.',
    'Select a Track to open it, or **New Campaign Track** to build one.',
    'A Track marked "Open to retry" had a build fail: open it and select **Retry**.',
  ],
  links: [{ label: 'Open Track Studio', href: '/studio' }],
  requires: ['tracks.author'],
};

export const buildTrackSection: GuideSection = {
  id: 'build-a-track',
  title: 'Build a Track from a Playbook PDF',
  what: 'Upload the campaign Playbook PDF and Pulse plans the Track, then writes the Checkpoints (Briefing Cards and Drills) and the Verbal Practice calls from it.',
  when: 'For a new campaign, or a new compliance topic with its own PDF.',
  steps: [
    'In **Track Studio**, select **New Campaign Track**.',
    'Pick the **Division**, type a **Track title** (and an optional code), and drop the Playbook PDF (up to 20 MB).',
    'Select **Upload and map content**.',
    'On the Content map, read **Source depth** and the AI\'s **Recommended** number of checkpoints and minutes. Change them with the steppers, or select **Use recommended**.',
    'Select **Approve source and build N checkpoints**.',
    'If Pulse finds places where the PDF contradicts itself, decide each one: **Follow the rule (page N)** or **Not a contradiction**. Then approve again.',
    'Watch **Live Build**. You can leave the page: the build keeps running and the Track opens in Track Studio when it is ready.',
  ],
  tips: [
    'Most Tracks build in a few minutes. The Division cannot be changed after this step.',
    'Pages that are only images teach nothing until you transcribe them in **Source Review**.',
    'Each Trainer can start 10 new builds a day (UTC). **Retry** and resuming a build do not count.',
    'If a build fails, open the Track and select **Retry**. It continues from the Checkpoints already written.',
  ],
  links: [{ label: 'New Campaign Track', href: '/studio/new' }],
  requires: ['tracks.author'],
};

export const editTrackSection: GuideSection = {
  id: 'edit-a-track',
  title: 'Review, test-play and edit a draft',
  what: 'Every Track has a draft you can test-play and edit before agents see it. The outline on the left lists Checkpoints and Verbal Practice scenarios; red marks show problems to fix.',
  when: 'After every build, and before every publish.',
  steps: [
    'Open the Track from **Track Studio**.',
    'Select **Play** to test-play a Checkpoint as an agent would. For a Verbal Practice scenario, select **Test-Play This Simulation** (it opens in a new tab; nothing is recorded).',
    'Select **Edit** to change titles, Briefing Cards (headline, body, key takeaway, DO and DON\'T) and Drills.',
    'To rewrite one item, select **Regenerate This Item**, add an optional **Hint**, and select **Regenerate**.',
    'If a Checkpoint has too few Drills, select **Add a Drill**.',
    'Select **Save Draft** (or press Ctrl/Cmd+S).',
  ],
  tips: [
    'Save before test-playing: test-play uses the saved draft.',
    'Pulse will not save while a problem is listed ("Fix these N problems to save the draft"). Select a problem to jump to it.',
    'Each Checkpoint needs at least 2 Briefing Cards and 4 Drills.',
    'Edits never change what agents see until you publish again.',
  ],
  links: [{ label: 'Open Track Studio', href: '/studio' }],
  requires: ['tracks.author'],
};

export const sourceReviewSection: GuideSection = {
  id: 'source-review',
  title: 'Source Review: check content against the PDF',
  what: 'Source Review shows each generated claim next to the exact Playbook passage it came from, and the **Publication gate**: "Ready to publish" or the blocking issues left.',
  when: 'When the Publish dialog or a Checkpoint says something needs evidence review, or before publishing a high-stakes Track.',
  steps: [
    'Open the Track and select **Source Review**.',
    'Use the filters (**Unsupported**, **Conflicted**, **Critical**…) to find items that need you.',
    'For each one, select **Approve exact evidence**, or **Find exact source passage** to link the right sentence. Fix or regenerate claims the PDF does not support.',
    'Check **Publish gate results** until it says **All gates pass**.',
  ],
  tips: [
    'Save the draft first: approving is disabled while there are unsaved edits.',
    'Approving evidence is recommended, not required. A claim the PDF does not support does block publishing.',
  ],
  requires: ['tracks.author'],
};

export const revisedPlaybookSection: GuideSection = {
  id: 'revised-playbook',
  title: 'Update a Track from a revised PDF',
  what: 'Upload a new version of the Playbook and Pulse rebuilds the draft from it. Agents keep training on the published version until you publish again.',
  when: 'When the campaign Playbook changes.',
  steps: [
    'Open the Track and select **Upload Revised Playbook** (**Revise PDF** on small screens).',
    'Drop the new PDF and select **Upload and Rebuild Draft**.',
    'When the build finishes, review and test-play the draft, then **Publish & Assign**.',
  ],
  tips: ['The new draft replaces the current draft, including unsaved edits. Publish or save anything you need first.'],
  requires: ['tracks.author'],
};

// ---------------------------------------------------------------------------------------------------------------
// Team insight
// ---------------------------------------------------------------------------------------------------------------

export const teamProgressSection = (audience: 'supervisor' | 'staff'): GuideSection => ({
  id: 'team-progress',
  title: 'Team Progress',
  what: 'One board per Track with a card per agent in four columns: **Not started**, **Learning**, **Ready for practice** and **Certified**. Agents who are stuck, failing or about to expire show first.',
  when: 'Daily, to see who is ready to take calls and who needs a nudge.',
  steps: [
    'Select **Team Progress** in the sidebar.',
    audience === 'supervisor'
      ? 'Pick a **Division** or **Track** filter if you need to. The Cohort is locked to your own.'
      : 'Pick a **Division**, **Cohort** or **Track** filter, or leave them on all.',
    'Select a Track tab ("Title · X of Y ready").',
    'Read the flags on each card (for example "Stuck 3 days on Checkpoint 2" or "No sim attempt in 5 days") and follow up.',
    'Select an agent\'s name to open their Readiness Passport.',
    'Select **Export CSV** to share the board.',
  ],
  tips: [
    '"Ready for calls" on this board means certified on the selected Track. On Home it means certified on every assigned Track.',
    'Ready = every Checkpoint done and every Verbal Practice scenario passed. Keep-Sharp reviews do not count toward it.',
    'A revoked certification moves the agent to the **Needs recert** box with "Revoked:" and the reason.',
    'Certification shows training is done; the decision to put someone on live calls is still yours.',
    audience === 'supervisor'
      ? 'Agents are listed under their home Cohort only. Someone from another team who is "also in" your Cohort shows on their own team\'s board, not yours.'
      : 'Agents are grouped by their home Cohort. The **Cohort** filter shows each agent under their home Cohort only, even if they are also in other Cohorts.',
  ],
  links: [{ label: 'Open Team Progress', href: '/progress' }],
  requires: ['progress.view'],
});

export const analyticsSection = (audience: 'supervisor' | 'staff'): GuideSection => ({
  id: 'analytics',
  title: 'Analytics',
  what: 'Strengths and blind spots: skill scores by Cohort and agent, status by agent for every Track, and the most-missed Drills.',
  when: 'For coaching plans and weekly reviews, or to find a Playbook rule that confuses many agents.',
  steps: [
    'Select **Analytics** in the sidebar.',
    audience === 'supervisor'
      ? 'Use the **Division** and **Track** filters. The Cohort is locked to your own.'
      : 'Use the **Division**, **Cohort** and **Track** filters. Pick a Cohort to see each of its agents.',
    'In **Skill strength by Cohort**, look for red cells (below 70%: needs coaching).',
    'In **Status by agent**, select **Export CSV** for a spreadsheet of every agent and Track.',
    audience === 'supervisor'
      ? 'In **Most-missed Drills**, a high count often means a rule needs explaining again.'
      : 'In **Most-missed Drills**, select **Open this item in Track Studio** to fix a confusing Drill or Briefing Card.',
  ],
  tips: ['Green is 85% or more, amber 70 to 84%.'],
  links: [{ label: 'Open Analytics', href: '/analytics' }],
  requires: ['analytics.view'],
});

export const passportSection = (audience: 'supervisor' | 'staff'): GuideSection => ({
  id: 'readiness-passport',
  title: 'An agent\'s Readiness Passport',
  what: 'One agent\'s full record: current evidence per Track, skill radar, certifications, Drill accuracy against Verbal Practice scores, and every graded practice transcript with coaching.',
  when: 'Before a coaching conversation, or to check why an agent is not ready yet.',
  steps: [
    audience === 'supervisor'
      ? 'Select the agent\'s name on Home, Team Progress or Analytics.'
      : 'Select the agent\'s name on Team Progress or Analytics.',
    'Read the per-Track panel for what is missing, then **Verbal Practice transcripts** for what they said and how it was scored.',
  ],
  tips: [
    audience === 'supervisor'
      ? 'You can open Passports for agents in your own Cohort.'
      : 'Staff can open any agent\'s Passport.',
    audience === 'supervisor'
      ? 'A certification a Trainer withdrew shows as **Revoked**. Ask your Trainer about the reason and what happens next.'
      : 'To withdraw a certification, use **Revoke** in **Campaign Certifications** (see "Revoke a certification").',
  ],
  requires: ['analytics.view'],
});

export const revokeCertificationSection: GuideSection = {
  id: 'revoke-certification',
  title: 'Revoke a certification',
  what: 'Withdraws an agent\'s certification on one Track. They stop counting as certified or ready for calls on it; their training history stays, and your reason and name are recorded in the certification history.',
  when: 'When an agent is certified but should not be: for example a compliance violation on a real call, or a policy change that their certification predates.',
  steps: [
    'Open the agent\'s Readiness Passport (select their name on **Team Progress** or **Analytics**).',
    'In **Campaign Certifications**, find the Track and select **Revoke**.',
    'Type the **Reason**. It is required and kept in the certification history.',
    'Select **Revoke certification**.',
  ],
  tips: [
    'A revoked certification does not come back by itself, even if the agent meets every requirement again. There is no reinstate button yet.',
    'The agent sees **Revoked** and your reason on the Track Map. Supervisors see "Revoked:" and the reason on Team Progress.',
    'Their Track goes back to in progress, so their Home card shows **Continue** instead of **Certified**.',
  ],
  links: [{ label: 'Open Team Progress', href: '/progress' }],
  requires: ['certifications.manage'],
};

export const manualScoringSection: GuideSection = {
  id: 'score-by-hand',
  title: 'Score a practice call by hand',
  what: 'When the AI coach cannot score a Verbal Practice call, it waits for a Trainer. The learner was told a Trainer will score it.',
  when: 'When **Calls waiting for a Trainer score** appears on Team Progress.',
  steps: [
    'Open **Team Progress** and find **Calls waiting for a Trainer score**.',
    'Select **Score this call**.',
    'Select **Export & Download Package**, score it with the external judge, then upload the result under **Import an external Judge result** and select **Import & Record Result**.',
  ],
  tips: ['Critical-rule failures cannot be overridden by a hand score. Draft and demo replay results never certify anyone.'],
  links: [{ label: 'Open Team Progress', href: '/progress' }],
  requires: ['sims.manualJudge'],
};

// ---------------------------------------------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------------------------------------------

export const rosterSection = (audience: 'trainer' | 'admin'): GuideSection => ({
  id: 'roster',
  title: 'The Roster',
  what:
    audience === 'admin'
      ? 'The people page: Cohorts and join codes at the top, then pending invites, then every user with their role, Cohort, Divisions and status.'
      : 'The people page: pending invites and every user with their role, Cohort, Divisions and status. Cohorts are shown for reference; only Admins change them.',
  when: 'To add people, fix someone\'s access, reset a password or offboard someone.',
  steps: [
    'Select **Roster** in the sidebar.',
    'Filter by **Cohort** and **Status** (**Active**, **Inactive**, **All statuses**).',
    'Use the buttons on a user row: **Access**, the key icon (reset password) and the deactivate icon.',
  ],
  tips: [
    'Rows you cannot manage show "Your account", "Higher role" or "View only".',
    'Open **Roles & permissions** to see exactly what each role can do.',
    'Filtering by **Cohort** also lists people who are only "also in" that Cohort, not just its home members.',
  ],
  links: [{ label: 'Open Roster', href: '/roster' }],
  requires: ['roster.view'],
});

export const inviteSection = (audience: 'trainer' | 'admin'): GuideSection => ({
  id: 'invite-staff',
  title: 'Invite someone by email',
  what: 'An invite creates a one-time setup link for a person with an email address. You pick their role, Cohort and Divisions now; they choose a password or use Google when they open it.',
  when: 'For new Trainers, Partner Supervisors and email-based agents. LC Number agents use Bulk Import or a join code instead.',
  steps: [
    'On the **Roster**, select **Invite Staff**.',
    'Type the **Full name** and **Work email**.',
    audience === 'trainer'
      ? 'Pick the **Role**: Trainer, Partner Supervisor or Agent.'
      : 'Pick the **Role**: Trainer, Partner Supervisor or Agent (only a Super Admin can invite Admins).',
    'Pick the **Cohort** and **Divisions**. Staff roles switch to the Internal Cohort automatically.',
    'Select **Create invite**. If Pulse emailed it, you see **Invite sent**; otherwise select **Copy link** and send it yourself.',
  ],
  tips: [
    'Invites expire after 30 days. The link works once.',
    'Under **Pending Staff & Supervisor Invites**, **Email again** or **Copy link** makes a new link (the old one stops working); **Revoke** cancels it.',
    'If the person already has an account, change it with **Access** instead.',
    ...(audience === 'trainer' ? ['You can invite another Trainer, but only an Admin can change or deactivate a Trainer afterwards.'] : []),
  ],
  links: [{ label: 'Open Roster', href: '/roster' }],
  requires: ['users.invite'],
});

export const bulkImportSection: GuideSection = {
  id: 'bulk-import',
  title: 'Bulk import agents from a CSV',
  what: 'Create many accounts at once from a spreadsheet. This is how LC Number agents get accounts without a join code.',
  when: 'When a new class of agents starts.',
  steps: [
    'On the **Roster**, select **Bulk Import**.',
    'Select **Download template** (pulse-roster-template.csv) and fill it in Excel or Google Sheets: displayName, lcNumber or email, partnerCohortId, and optionally role, divisionIds and initialPassword.',
    'Save as CSV, then select **Upload CSV** (or paste the rows).',
    'Check the preview: every row should say **Ready**. Fix rows with errors.',
    'Select **Import N rows**.',
    'Select **Download credentials CSV** straight away and share each login securely.',
  ],
  tips: [
    'Pulse does not keep a copy of the temporary passwords. If you lose the file, reset the passwords one by one.',
    'Blank role = Agent. Blank divisionIds = the Cohort\'s default Divisions. Separate several Divisions with |.',
    'Up to 500 rows per import. Excel files must be saved as CSV first.',
    'Everyone imported must choose their own password (at least 10 characters) the first time they sign in, the same as after a reset. An initialPassword you set must also be at least 10 characters.',
  ],
  links: [{ label: 'Open Roster', href: '/roster' }],
  requires: ['users.invite'],
};

export const resetPasswordSection = (audience: 'supervisor' | 'trainer' | 'admin'): GuideSection => ({
  id: 'reset-password',
  title: 'Reset a password',
  what: 'Issue a temporary password when someone with an LC Number or email password is locked out. They must choose their own password the next time they sign in.',
  when: 'When an agent tells you they forgot their password. LC Number agents have no reset email, so they rely on you.',
  steps: [
    audience === 'supervisor'
      ? 'Find the agent on Home and select the key icon (**Reset password**) next to their LC Number. It is also next to their name on their Readiness Passport.'
      : 'On the **Roster**, select the key icon on the person\'s row.',
    'Select **Issue Temporary Password**.',
    'Select **Copy credentials** and give the login ID and temporary password to the person privately.',
    'They sign in and Pulse asks them to choose a new password.',
  ],
  tips: [
    'Their open sessions end straight away.',
    audience === 'supervisor'
      ? 'You can reset passwords for active agents in your own Cohort only.'
      : audience === 'trainer'
        ? 'You can reset Partner Supervisors and Agents.'
        : 'You can reset Trainers, Partner Supervisors and Agents. Only a Super Admin resets Admins.',
    'Google sign-in accounts have no Pulse password, so there is nothing to reset.',
  ],
  links: audience === 'supervisor' ? [{ label: 'Go to Home', href: '/' }] : [{ label: 'Open Roster', href: '/roster' }],
  requires: ['users.resetPassword'],
});

export const deactivateSection = (audience: 'trainer' | 'admin'): GuideSection => ({
  id: 'deactivate',
  title: 'Deactivate or reactivate someone',
  what: 'Deactivating stops sign-in at once but keeps all their completions, scores and transcripts. Reactivating restores the same account.',
  when: 'When someone leaves the campaign or the company, or comes back.',
  steps: [
    'On the **Roster**, select the deactivate icon on the person\'s row.',
    'Select **Deactivate** to confirm. Use **Status: Inactive** to find them later and select **Reactivate**.',
  ],
  tips: [
    audience === 'trainer' ? 'You can deactivate Partner Supervisors and Agents.' : 'You can deactivate Trainers, Partner Supervisors and Agents.',
    'Deactivated agents are hidden from Team Progress and Home ("Show offboarded" brings them back).',
  ],
  links: [{ label: 'Open Roster', href: '/roster' }],
  requires: ['users.deactivate'],
});

export const aiStatusSection: GuideSection = {
  id: 'ai-status',
  title: 'AI status pill',
  what: 'The pill in the top bar (wide screens) shows whether the AI that builds Tracks and runs Verbal Practice is working: **AI ready**, **AI busy** or **AI unavailable**.',
  when: 'When a build or a practice call is slow or fails.',
  steps: ['Hover the pill to see the provider and each capability\'s status.'],
  tips: ['**AI busy** is normal during a build. If it stays **AI unavailable**, tell your LogiCall admin.'],
  requires: ['system.aiHealth'],
};
