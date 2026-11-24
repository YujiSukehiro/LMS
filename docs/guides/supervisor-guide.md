# Supervisor guide

You use Pulse to see which agents in your Cohort are ready to take calls, coach the ones who are not, and get locked-out agents back in. You see your own Cohort only.

> Generated from `src/lib/guides/`. Do not edit by hand: change the guide data and run `npm run guides:export`.

## Contents

- Getting started
  - [Sign in](#sign-in)
  - [Forgot your password](#forgot-password)
  - [Your Home page](#home)
- Your team
  - [Team Progress](#team-progress)
  - [Analytics](#analytics)
  - [An agent's Readiness Passport](#readiness-passport)
  - [Reset a password](#reset-password)
  - [Adding or changing agents](#add-agents)
  - [Who sees which Track](#who-sees-a-track)
- More
  - [What your agents see](#agent-experience)
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

**What it is.** Home is your Cohort at a glance: how many agents are **Ready for calls** (certified on all their Tracks), the practice pass rate, the average skill score, and each agent's status on every Track.

**When to use it.** At the start of each shift, to see who is ready and who needs help.

**How to:**

1. Read the four tiles at the top.
2. In **Agents**, read each agent's status chips (one per Track) and **Last activity**.
3. Select an agent's name to open their Readiness Passport.
4. Select **Open Cohort Analytics** for skill strengths and the most-missed Drills.

**Tips:**

- Agents who left are hidden. Select **Show offboarded** to see them.

**Open in Pulse:** **Go to Home** (`/`)

## Your team

<a id="team-progress"></a>

### Team Progress

**What it is.** One board per Track with a card per agent in four columns: **Not started**, **Learning**, **Ready for practice** and **Certified**. Agents who are stuck, failing or about to expire show first.

**When to use it.** Daily, to see who is ready to take calls and who needs a nudge.

**How to:**

1. Select **Team Progress** in the sidebar.
2. Pick a **Division** or **Track** filter if you need to. The Cohort is locked to your own.
3. Select a Track tab ("Title · X of Y ready").
4. Read the flags on each card (for example "Stuck 3 days on Checkpoint 2" or "No sim attempt in 5 days") and follow up.
5. Select an agent's name to open their Readiness Passport.
6. Select **Export CSV** to share the board.

**Tips:**

- "Ready for calls" on this board means certified on the selected Track. On Home it means certified on every assigned Track.
- Ready = every Checkpoint done and every Verbal Practice scenario passed. Keep-Sharp reviews do not count toward it.
- Certification shows training is done; the decision to put someone on live calls is still yours.
- Agents are listed under their home Cohort only. Someone from another team who is "also in" your Cohort shows on their own team's board, not yours.

**Open in Pulse:** **Open Team Progress** (`/progress`)

<a id="analytics"></a>

### Analytics

**What it is.** Strengths and blind spots: skill scores by Cohort and agent, status by agent for every Track, and the most-missed Drills.

**When to use it.** For coaching plans and weekly reviews, or to find a Playbook rule that confuses many agents.

**How to:**

1. Select **Analytics** in the sidebar.
2. Use the **Division** and **Track** filters. The Cohort is locked to your own.
3. In **Skill strength by Cohort**, look for red cells (below 70%: needs coaching).
4. In **Status by agent**, select **Export CSV** for a spreadsheet of every agent and Track.
5. In **Most-missed Drills**, a high count often means a rule needs explaining again.

**Tips:**

- Green is 85% or more, amber 70 to 84%.

**Open in Pulse:** **Open Analytics** (`/analytics`)

<a id="readiness-passport"></a>

### An agent's Readiness Passport

**What it is.** One agent's full record: current evidence per Track, skill radar, certifications, Drill accuracy against Verbal Practice scores, and every graded practice transcript with coaching.

**When to use it.** Before a coaching conversation, or to check why an agent is not ready yet.

**How to:**

1. Select the agent's name on Home, Team Progress or Analytics.
2. Read the per-Track panel for what is missing, then **Verbal Practice transcripts** for what they said and how it was scored.

**Tips:**

- You can open Passports for agents in your own Cohort.

<a id="reset-password"></a>

### Reset a password

**What it is.** Issue a temporary password when someone with an LC Number or email password is locked out. They must choose their own password the next time they sign in.

**When to use it.** When an agent tells you they forgot their password. LC Number agents have no reset email, so they rely on you.

**How to:**

1. Find the agent on Home and select the key icon (**Reset password**) next to their LC Number. It is also next to their name on their Readiness Passport.
2. Select **Issue Temporary Password**.
3. Select **Copy credentials** and give the login ID and temporary password to the person privately.
4. They sign in and Pulse asks them to choose a new password.

**Tips:**

- Their open sessions end straight away.
- You can reset passwords for active agents in your own Cohort only.
- Google sign-in accounts have no Pulse password, so there is nothing to reset.

**Open in Pulse:** **Go to Home** (`/`)

<a id="add-agents"></a>

### Adding or changing agents

**What it is.** Supervisors do not open the Roster. LogiCall Trainers and Admins create accounts, change Cohorts, roles and Divisions, and assign trainings to your Cohort or to single agents.

**When to use it.** When new agents start, an agent moves team, or someone leaves.

**How to:**

1. New agents: ask your LogiCall Trainer or Admin to bulk-import them, or for your Cohort's join code, which agents type on the sign-in page under **Have a Team Join Code? Claim Access**.
2. Moves, wrong Divisions and leavers: send the agent's name and LC Number to your LogiCall Trainer or Admin.
3. A training for one agent only, or for your whole Cohort: ask your Trainer. They can assign it to the Cohort or to the agent by name.

**Tips:**

- An agent who joins with a code lands in your Cohort with its default Divisions.
- Agents from another team who are only "also in" your Cohort take its trainings, but stay under their own home Cohort and supervisor. They do not appear on your Home or Team Progress.

<a id="who-sees-a-track"></a>

### Who sees which Track

**What it is.** An agent sees a published Track when it is assigned to every Cohort, to any of their Cohorts (their home Cohort or one they are also in), or to them by name, and they have the Track's Division, for example Telehealth.

**When to use it.** When an agent says a Track is missing, or Team Progress shows "Not assigned" for someone.

**How to:**

1. Open the agent's Readiness Passport and check their Cohort and Division pills.
2. If the Division is wrong, or the agent should also be in another Cohort, ask your LogiCall Trainer or Admin. They change it with **Access** on the Roster.
3. If the Track is not assigned to your Cohort or to the agent, ask your Trainer to assign it.

**Tips:**

- The Division rule always applies: someone assigned by name or through a Cohort still needs the Track's Division. A user with no Divisions sees no Tracks.
- On Team Progress and Analytics, a Track the agent cannot see shows as "Not assigned" for them.
- Changes to Cohorts, Divisions and assignments apply straight away. Nobody has to sign out.

## More

<a id="agent-experience"></a>

### What your agents see

**What it is.** The Agent guide explains each step your agents go through: Checkpoints, Drills, Verbal Practice, certification and Keep-Sharp reviews.

**When to use it.** Before coaching, or when an agent asks how something works.

**How to:**

1. Select the **Agent** tab at the top of this page.

**Open in Pulse:** **Open the Agent guide** (`/guide?role=agent`)

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
