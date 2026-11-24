# Trainer guide

You use Pulse to turn campaign Playbook PDFs into Tracks, publish them to Cohorts, watch who is ready, and look after supervisors and agents. You see every Cohort.

> Generated from `src/lib/guides/`. Do not edit by hand: change the guide data and run `npm run guides:export`.

## Contents

- Getting started
  - [Sign in](#sign-in)
  - [Forgot your password](#forgot-password)
  - [Your Home page](#home)
- Building trainings
  - [Track Studio](#track-studio)
  - [Build a Track from a Playbook PDF](#build-a-track)
  - [Review, test-play and edit a draft](#edit-a-track)
  - [Source Review: check content against the PDF](#source-review)
  - [Publish and assign a Track](#publish-assign)
  - [Assign trainings to Cohorts or people](#assign-trainings)
  - [Update a Track from a revised PDF](#revised-playbook)
- Progress and coaching
  - [Team Progress](#team-progress)
  - [Score a practice call by hand](#score-by-hand)
  - [Analytics](#analytics)
  - [An agent's Readiness Passport](#readiness-passport)
- People
  - [The Roster](#roster)
  - [Invite someone by email](#invite-staff)
  - [Bulk import agents from a CSV](#bulk-import)
  - [Change role, Cohort and Divisions](#edit-access)
  - [Reset a password](#reset-password)
  - [Deactivate or reactivate someone](#deactivate)
  - [Who sees which Track](#who-sees-a-track)
  - [Cohorts and join codes](#cohorts-admin-only)
- More
  - [What supervisors see](#supervisor-experience)
  - [What your agents see](#agent-experience)
  - [AI status pill](#ai-status)
  - [Theme, this guide and signing out](#account-menu)

## Getting started

<a id="sign-in"></a>

### Sign in

**What it is.** Pulse is invite-only. LogiCall staff sign in with Google; everyone else needs an invite setup link (email) or, for LC Number agents, an account from Bulk Import or a Cohort join code.

**When to use it.** Every time you open Pulse, and the first time you set up your account.

**How to:**

1. LogiCall staff: select **Continue with Google** and pick your @logicall.io or @logicall.live account.
2. Invited by email: open the one-time setup link from the invite email, choose a password (at least 8 characters) and select **Create my account**, or select **Use my Google account** for that same address.
3. Accounts with a password: type your LC Number or email in **LC Number or Email**, your **Password**, then select **Sign In**.

**Tips:**

- A Google account outside @logicall.io and @logicall.live is refused unless it was invited first.
- A first-time @logicall.io / @logicall.live Google sign-in with no invite starts as an Agent in the LogiCall Internal Cohort. To make them staff, change their role with **Access** on the Roster, or invite them before they sign in.
- Setup links work once. If yours says **Invite not available**, ask for a new one.
- A deactivated account cannot sign in. Contact your LogiCall administrator.

<a id="forgot-password"></a>

### Forgot your password

**What it is.** How you get back in depends on how you sign in: LC Number agents get a temporary password from a person; email accounts get a reset link; Google accounts reset with Google.

**When to use it.** When your password does not work.

**How to:**

1. On the sign-in page, type your LC Number or email first, then select **Forgot password?**.
2. LC Number: the page tells you to ask your supervisor or LogiCall admin for a temporary password. They issue it from Pulse.
3. Email: select **Send reset link** and follow the link in your inbox.
4. Sign in with the temporary password. Pulse opens **Choose a new password**: type a new password (at least 10 characters) twice and select **Save password and continue**.

**Tips:**

- You cannot skip the new-password step: every page sends you back to it until you save.
- Google sign-in accounts have no Pulse password. Reset it with Google.
- To issue a temporary password to someone else, see "Reset a password".

<a id="home"></a>

### Your Home page

**What it is.** Home counts your Tracks by status (Drafts, Generating, Published), lists recently updated Tracks and shows the most-missed items across all Cohorts.

**When to use it.** At the start of the day, to pick up drafts and spot confusing content.

**How to:**

1. Select a Track under **Recently updated Tracks** to open it.
2. Select **New Campaign Track** to build a new one.
3. Under **Top missed items**, select an item to fix it in Track Studio.

**Open in Pulse:** **Go to Home** (`/`)

## Building trainings

<a id="track-studio"></a>

### Track Studio

**What it is.** The list of every Track (one per campaign or topic) with its Division, status (**Generating**, **Build failed**, **Draft**, **Published**), published version and size.

**When to use it.** To find a Track to test-play, edit or publish, or to start a new one.

**How to:**

1. Select **Track Studio** in the sidebar.
2. Select a Track to open it, or **New Campaign Track** to build one.
3. A Track marked "Open to retry" had a build fail: open it and select **Retry**.

**Open in Pulse:** **Open Track Studio** (`/studio`)

<a id="build-a-track"></a>

### Build a Track from a Playbook PDF

**What it is.** Upload the campaign Playbook PDF and Pulse plans the Track, then writes the Checkpoints (Briefing Cards and Drills) and the Verbal Practice calls from it.

**When to use it.** For a new campaign, or a new compliance topic with its own PDF.

**How to:**

1. In **Track Studio**, select **New Campaign Track**.
2. Pick the **Division**, type a **Track title** (and an optional code), and drop the Playbook PDF (up to 20 MB).
3. Select **Upload and map content**.
4. On the Content map, read **Source depth** and the AI's **Recommended** number of checkpoints and minutes. Change them with the steppers, or select **Use recommended**.
5. Select **Approve source and build N checkpoints**.
6. If Pulse finds places where the PDF contradicts itself, decide each one: **Follow the rule (page N)** or **Not a contradiction**. Then approve again.
7. Watch **Live Build**. You can leave the page: the build keeps running and the Track opens in Track Studio when it is ready.

**Tips:**

- Most Tracks build in a few minutes. The Division cannot be changed after this step.
- Pages that are only images teach nothing until you transcribe them in **Source Review**.
- Each Trainer can start 10 new builds a day (UTC). **Retry** and resuming a build do not count.
- If a build fails, open the Track and select **Retry**. It continues from the Checkpoints already written.

**Open in Pulse:** **New Campaign Track** (`/studio/new`)

<a id="edit-a-track"></a>

### Review, test-play and edit a draft

**What it is.** Every Track has a draft you can test-play and edit before agents see it. The outline on the left lists Checkpoints and Verbal Practice scenarios; red marks show problems to fix.

**When to use it.** After every build, and before every publish.

**How to:**

1. Open the Track from **Track Studio**.
2. Select **Play** to test-play a Checkpoint as an agent would. For a Verbal Practice scenario, select **Test-Play This Simulation** (it opens in a new tab; nothing is recorded).
3. Select **Edit** to change titles, Briefing Cards (headline, body, key takeaway, DO and DON'T) and Drills.
4. To rewrite one item, select **Regenerate This Item**, add an optional **Hint**, and select **Regenerate**.
5. If a Checkpoint has too few Drills, select **Add a Drill**.
6. Select **Save Draft** (or press Ctrl/Cmd+S).

**Tips:**

- Save before test-playing: test-play uses the saved draft.
- Pulse will not save while a problem is listed ("Fix these N problems to save the draft"). Select a problem to jump to it.
- Each Checkpoint needs at least 2 Briefing Cards and 4 Drills.
- Edits never change what agents see until you publish again.

**Open in Pulse:** **Open Track Studio** (`/studio`)

<a id="source-review"></a>

### Source Review: check content against the PDF

**What it is.** Source Review shows each generated claim next to the exact Playbook passage it came from, and the **Publication gate**: "Ready to publish" or the blocking issues left.

**When to use it.** When the Publish dialog or a Checkpoint says something needs evidence review, or before publishing a high-stakes Track.

**How to:**

1. Open the Track and select **Source Review**.
2. Use the filters (**Unsupported**, **Conflicted**, **Critical**…) to find items that need you.
3. For each one, select **Approve exact evidence**, or **Find exact source passage** to link the right sentence. Fix or regenerate claims the PDF does not support.
4. Check **Publish gate results** until it says **All gates pass**.

**Tips:**

- Save the draft first: approving is disabled while there are unsaved edits.
- Approving evidence is recommended, not required. A claim the PDF does not support does block publishing.

<a id="publish-assign"></a>

### Publish and assign a Track

**What it is.** Publishing freezes the draft as a new version (v1, v2…) and sets who must take it: Cohorts, specific people, or both. They see it on their Home page if they have the Track's Division.

**When to use it.** When the Track has been reviewed and test-played, and each time you want learners to get your latest edits.

**How to:**

1. Open the Track in **Track Studio** and select **Publish & Assign**.
2. Read **Suggested review before going live**. It is advice only: you can still publish.
3. Under **Target Cohorts**, tick each Cohort that must take the Track, or tick **Every Cohort, including ones added later**.
4. To add one person (for example someone outside those Cohorts), type their name or LC Number under **Specific people** and tick them.
5. Check the total ("Reaches N agents in the Cohorts, plus N named people.") and select **Publish Track**.
6. On **Published as TrackVersion vN**, select **Copy** to share the Track link, then **Done**.

**Tips:**

- Only real problems block publishing (for example a claim the Playbook does not support, or a thin Checkpoint). They are listed with an **Open Source Review** button. Evidence sign-off is a suggestion, not a blocker.
- Already published and only changing who takes it? Select **Save assignment only**. No new version is made and agents keep the same content.
- Cohorts with no agents in the Track's Division are hidden from the list, and only agents with the Division appear under **Specific people**.
- A republish keeps the current Cohorts and people ticked. Agents keep their progress; only changes to what is assessed send certified agents back to recertify.
- The Track's Division is set when you create it and cannot be changed later.

**Open in Pulse:** **Open Track Studio** (`/studio`)

<a id="assign-trainings"></a>

### Assign trainings to Cohorts or people

**What it is.** You can assign published trainings from either side: from a Cohort (which trainings this team takes) or from a Track (which Cohorts and people take this training). Both change the same assignment.

**When to use it.** From the Cohort when a team starts or changes campaign and needs several trainings at once. From the Track when one training goes to several Cohorts, or to a few named people.

**How to:**

1. Cohort side: open **Roster**, find the Cohort card and select **Trainings (N)**.
2. Tick each training this Cohort must take and select **Save trainings**.
3. Training side: open the Track in **Track Studio** and select **Publish & Assign**.
4. Tick Cohorts under **Target Cohorts** and add people under **Specific people**, then select **Save assignment only** (or **Publish Track** if you also want to publish your latest draft).

**Tips:**

- A Cohort's trainings reach everyone in it, including people who are only "also in" that Cohort.
- Trainings published to **Every Cohort** show ticked and locked in a Cohort's **Trainings** list. Change those from the Track.
- Only published trainings can be assigned. Agents still need the training's Division to see it.

**Open in Pulse:** **Open Roster** (`/roster`) · **Open Track Studio** (`/studio`)

<a id="revised-playbook"></a>

### Update a Track from a revised PDF

**What it is.** Upload a new version of the Playbook and Pulse rebuilds the draft from it. Agents keep training on the published version until you publish again.

**When to use it.** When the campaign Playbook changes.

**How to:**

1. Open the Track and select **Upload Revised Playbook** (**Revise PDF** on small screens).
2. Drop the new PDF and select **Upload and Rebuild Draft**.
3. When the build finishes, review and test-play the draft, then **Publish & Assign**.

**Tips:**

- The new draft replaces the current draft, including unsaved edits. Publish or save anything you need first.

## Progress and coaching

<a id="team-progress"></a>

### Team Progress

**What it is.** One board per Track with a card per agent in four columns: **Not started**, **Learning**, **Ready for practice** and **Certified**. Agents who are stuck, failing or about to expire show first.

**When to use it.** Daily, to see who is ready to take calls and who needs a nudge.

**How to:**

1. Select **Team Progress** in the sidebar.
2. Pick a **Division**, **Cohort** or **Track** filter, or leave them on all.
3. Select a Track tab ("Title · X of Y ready").
4. Read the flags on each card (for example "Stuck 3 days on Checkpoint 2" or "No sim attempt in 5 days") and follow up.
5. Select an agent's name to open their Readiness Passport.
6. Select **Export CSV** to share the board.

**Tips:**

- "Ready for calls" on this board means certified on the selected Track. On Home it means certified on every assigned Track.
- Ready = every Checkpoint done and every Verbal Practice scenario passed. Keep-Sharp reviews do not count toward it.
- Certification shows training is done; the decision to put someone on live calls is still yours.
- Agents are grouped by their home Cohort. The **Cohort** filter shows each agent under their home Cohort only, even if they are also in other Cohorts.

**Open in Pulse:** **Open Team Progress** (`/progress`)

<a id="score-by-hand"></a>

### Score a practice call by hand

**What it is.** When the AI coach cannot score a Verbal Practice call, it waits for a Trainer. The learner was told a Trainer will score it.

**When to use it.** When **Calls waiting for a Trainer score** appears on Team Progress.

**How to:**

1. Open **Team Progress** and find **Calls waiting for a Trainer score**.
2. Select **Score this call**.
3. Select **Export & Download Package**, score it with the external judge, then upload the result under **Import an external Judge result** and select **Import & Record Result**.

**Tips:**

- Critical-rule failures cannot be overridden by a hand score. Draft and demo replay results never certify anyone.

**Open in Pulse:** **Open Team Progress** (`/progress`)

<a id="analytics"></a>

### Analytics

**What it is.** Strengths and blind spots: skill scores by Cohort and agent, status by agent for every Track, and the most-missed Drills.

**When to use it.** For coaching plans and weekly reviews, or to find a Playbook rule that confuses many agents.

**How to:**

1. Select **Analytics** in the sidebar.
2. Use the **Division**, **Cohort** and **Track** filters. Pick a Cohort to see each of its agents.
3. In **Skill strength by Cohort**, look for red cells (below 70%: needs coaching).
4. In **Status by agent**, select **Export CSV** for a spreadsheet of every agent and Track.
5. In **Most-missed Drills**, select **Open this item in Track Studio** to fix a confusing Drill or Briefing Card.

**Tips:**

- Green is 85% or more, amber 70 to 84%.

**Open in Pulse:** **Open Analytics** (`/analytics`)

<a id="readiness-passport"></a>

### An agent's Readiness Passport

**What it is.** One agent's full record: current evidence per Track, skill radar, certifications, Drill accuracy against Verbal Practice scores, and every graded practice transcript with coaching.

**When to use it.** Before a coaching conversation, or to check why an agent is not ready yet.

**How to:**

1. Select the agent's name on Team Progress or Analytics.
2. Read the per-Track panel for what is missing, then **Verbal Practice transcripts** for what they said and how it was scored.

**Tips:**

- Staff can open any agent's Passport.

## People

<a id="roster"></a>

### The Roster

**What it is.** The people page: pending invites and every user with their role, Cohort, Divisions and status. Cohorts are shown for reference; only Admins change them.

**When to use it.** To add people, fix someone's access, reset a password or offboard someone.

**How to:**

1. Select **Roster** in the sidebar.
2. Filter by **Cohort** and **Status** (**Active**, **Inactive**, **All statuses**).
3. Use the buttons on a user row: **Access**, the key icon (reset password) and the deactivate icon.

**Tips:**

- Rows you cannot manage show "Your account", "Higher role" or "View only".
- Open **Roles & permissions** to see exactly what each role can do.
- Filtering by **Cohort** also lists people who are only "also in" that Cohort, not just its home members.

**Open in Pulse:** **Open Roster** (`/roster`)

<a id="invite-staff"></a>

### Invite someone by email

**What it is.** An invite creates a one-time setup link for a person with an email address. You pick their role, Cohort and Divisions now; they choose a password or use Google when they open it.

**When to use it.** For new Trainers, Partner Supervisors and email-based agents. LC Number agents use Bulk Import or a join code instead.

**How to:**

1. On the **Roster**, select **Invite Staff**.
2. Type the **Full name** and **Work email**.
3. Pick the **Role**: Trainer, Partner Supervisor or Agent.
4. Pick the **Cohort** and **Divisions**. Staff roles switch to the Internal Cohort automatically.
5. Select **Create invite**. If Pulse emailed it, you see **Invite sent**; otherwise select **Copy link** and send it yourself.

**Tips:**

- Invites expire after 30 days. The link works once.
- Under **Pending Staff & Supervisor Invites**, **Email again** or **Copy link** makes a new link (the old one stops working); **Revoke** cancels it.
- If the person already has an account, change it with **Access** instead.
- You can invite another Trainer, but only an Admin can change or deactivate a Trainer afterwards.

**Open in Pulse:** **Open Roster** (`/roster`)

<a id="bulk-import"></a>

### Bulk import agents from a CSV

**What it is.** Create many accounts at once from a spreadsheet. This is how LC Number agents get accounts without a join code.

**When to use it.** When a new class of agents starts.

**How to:**

1. On the **Roster**, select **Bulk Import**.
2. Select **Download template** (pulse-roster-template.csv) and fill it in Excel or Google Sheets: displayName, lcNumber or email, partnerCohortId, and optionally role, divisionIds and initialPassword.
3. Save as CSV, then select **Upload CSV** (or paste the rows).
4. Check the preview: every row should say **Ready**. Fix rows with errors.
5. Select **Import N rows**.
6. Select **Download credentials CSV** straight away and share each login securely.

**Tips:**

- Pulse does not keep a copy of the temporary passwords. If you lose the file, reset the passwords one by one.
- Blank role = Agent. Blank divisionIds = the Cohort's default Divisions. Separate several Divisions with |.
- Up to 500 rows per import. Excel files must be saved as CSV first.
- Imported accounts are not forced to change their password. Ask agents to keep it private.

**Open in Pulse:** **Open Roster** (`/roster`)

<a id="edit-access"></a>

### Change role, Cohort and Divisions

**What it is.** The **Access** button on a Roster row changes a person's name, role, home Cohort, the other Cohorts they are also in, and their Divisions. Together these decide which Tracks they see.

**When to use it.** When someone moves team, also works for another team, changes campaign, gets promoted, or cannot see a Track they should.

**How to:**

1. Open **Roster** and find the person (filter by **Cohort** or **Status** if needed).
2. Select **Access** on their row.
3. Change **Role**, **Home Cohort** or **Divisions** as needed.
4. Under **Also in these Cohorts**, tick any other Cohort whose trainings they should also take.
5. Select **Save access**. A role or home Cohort change ends their old sessions, so they sign in again.

**Tips:**

- Trainers manage Partner Supervisors and Agents. Other Trainers and Admins show "Higher role".
- Trainer, Admin and Super Admin accounts must stay in the LogiCall Internal Cohort. Move the person to the Internal Cohort first, then change the role.
- The home Cohort decides who supervises them and where they show on Team Progress. Extra Cohorts only add trainings.
- Nobody can change their own access.

**Open in Pulse:** **Open Roster** (`/roster`)

<a id="reset-password"></a>

### Reset a password

**What it is.** Issue a temporary password when someone with an LC Number or email password is locked out. They must choose their own password the next time they sign in.

**When to use it.** When an agent tells you they forgot their password. LC Number agents have no reset email, so they rely on you.

**How to:**

1. On the **Roster**, select the key icon on the person's row.
2. Select **Issue Temporary Password**.
3. Select **Copy credentials** and give the login ID and temporary password to the person privately.
4. They sign in and Pulse asks them to choose a new password.

**Tips:**

- Their open sessions end straight away.
- You can reset Partner Supervisors and Agents.
- Google sign-in accounts have no Pulse password, so there is nothing to reset.

**Open in Pulse:** **Open Roster** (`/roster`)

<a id="deactivate"></a>

### Deactivate or reactivate someone

**What it is.** Deactivating stops sign-in at once but keeps all their completions, scores and transcripts. Reactivating restores the same account.

**When to use it.** When someone leaves the campaign or the company, or comes back.

**How to:**

1. On the **Roster**, select the deactivate icon on the person's row.
2. Select **Deactivate** to confirm. Use **Status: Inactive** to find them later and select **Reactivate**.

**Tips:**

- You can deactivate Partner Supervisors and Agents.
- Deactivated agents are hidden from Team Progress and Home ("Show offboarded" brings them back).

**Open in Pulse:** **Open Roster** (`/roster`)

<a id="who-sees-a-track"></a>

### Who sees which Track

**What it is.** An agent sees a published Track when it is assigned to every Cohort, to any of their Cohorts (their home Cohort or one they are also in), or to them by name, and they have the Track's Division, for example Telehealth.

**When to use it.** Before you publish, and when an agent says a Track is missing.

**How to:**

1. On the Roster, check the agent's **Cohort** and **Divisions** columns. Select **Access** to see the Cohorts they are also in.
2. Wrong Division, or they should also be in another team's Cohort: fix it with **Access** (see "Change role, Cohort and Divisions").
3. Track not assigned to them: assign it from the Cohort card (**Trainings**) or from the Track (**Publish & Assign**). See "Assign trainings to Cohorts or people".

**Tips:**

- The Division rule always applies: someone assigned by name or through a Cohort still needs the Track's Division. A user with no Divisions sees no Tracks.
- On Team Progress and Analytics, a Track the agent cannot see shows as "Not assigned" for them.
- Changes to Cohorts, Divisions and assignments apply straight away. Nobody has to sign out.

<a id="cohorts-admin-only"></a>

### Cohorts and join codes

**What it is.** Creating, editing and deleting Cohorts, and managing join codes, is for Admins only. You can still choose each Cohort's trainings with **Trainings** on its card, and add people to extra Cohorts with **Access**.

**When to use it.** When a new partner team needs a Cohort or a join code.

**How to:**

1. Ask a LogiCall Admin to create the Cohort or turn on its join code.

## More

<a id="supervisor-experience"></a>

### What supervisors see

**What it is.** Partner Supervisors see their own Cohort only: Home, Team Progress, Analytics and Passports, and they can reset passwords for their agents.

**When to use it.** When onboarding a partner supervisor or answering their questions.

**How to:**

1. Select the **Supervisor** tab at the top of this page.

**Open in Pulse:** **Open the Supervisor guide** (`/guide?role=supervisor`)

<a id="agent-experience"></a>

### What your agents see

**What it is.** The Agent guide walks through the learner side: Checkpoints, Drills, Verbal Practice, certification and Keep-Sharp reviews.

**When to use it.** Before you publish, to know what agents will go through, or when answering agent questions.

**How to:**

1. Select the **Agent** tab at the top of this page, or test-play a Track with **Play** in Track Studio.

**Open in Pulse:** **Open the Agent guide** (`/guide?role=agent`)

<a id="ai-status"></a>

### AI status pill

**What it is.** The pill in the top bar (wide screens) shows whether the AI that builds Tracks and runs Verbal Practice is working: **AI ready**, **AI busy** or **AI unavailable**.

**When to use it.** When a build or a practice call is slow or fails.

**How to:**

1. Hover the pill to see the provider and each capability's status.

**Tips:**

- **AI busy** is normal during a build. If it stays **AI unavailable**, tell your LogiCall admin.

<a id="account-menu"></a>

### Theme, this guide and signing out

**What it is.** The account menu (your initials, top right) holds the color theme, a link to this guide, and **Sign out**.

**When to use it.** When the screen is hard to read, when you need help, or on a shared computer.

**How to:**

1. Select your initials in the top-right corner.
2. Under **Theme**, pick **Light**, **Dark**, **Contrast** or **System**. Pulse remembers your choice.
3. Select **How-to guide** to open this page. **Guide** is also at the bottom of the left sidebar.
4. Select **Sign out** when you finish on a shared computer.

**Open in Pulse:** **Open the Guide** (`/guide`)
