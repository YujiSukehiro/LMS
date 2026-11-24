import type { RoleGuide } from './types';
import { accountMenuSection, forgotPasswordSection, signInSection } from './shared';

export const AGENT_GUIDE: RoleGuide = {
  role: 'AGENT',
  label: 'Agent',
  title: 'Agent guide',
  intro:
    'You use Pulse to learn each campaign before you take its calls: read short Briefing Cards, answer Drills, then pass Verbal Practice calls. When every Checkpoint and every Verbal Practice scenario is done, you are certified on that Track.',
  chapters: [
    {
      id: 'getting-started',
      title: 'Getting started',
      sections: [
        signInSection('agent'),
        forgotPasswordSection('agent'),
        {
          id: 'home',
          title: 'Your Home page',
          what: 'Home shows your Tracks (one per campaign), your XP, streak and readiness, and how many Keep-Sharp reviews are due.',
          when: 'Start every session here to see what to do next.',
          steps: [
            'Look at **Assigned Tracks**. Tracks you have started come first, then new ones, then certified ones.',
            'Select a Track card (**Start Track**, **Continue** or **Practice Again**) to open its Track Map.',
            'If the **Knowledge Retention** card says reviews are due, select **Start Keep-Sharp Review**.',
          ],
          tips: [
            'You see a Track when it is assigned to one of your Cohorts or to you by name, and it is in one of your Divisions (for example Telehealth). If a Track you expect is missing, ask your supervisor.',
            'The progress bar reaches 100% only after every Checkpoint and every Verbal Practice scenario is passed.',
          ],
          links: [{ label: 'Go to Home', href: '/' }],
        },
      ],
    },
    {
      id: 'learning',
      title: 'Learning a Track',
      sections: [
        {
          id: 'track-map',
          title: 'The Track Map',
          what: 'The Track Map is the path through one Track: numbered Checkpoints in order, then Verbal Practice at the end, plus your **Path to certification**.',
          when: 'Each time you open a Track, to pick the next step.',
          steps: [
            'From Home, select a Track card.',
            'Select **Start Checkpoint** on the next open Checkpoint.',
            'Finished Checkpoints show your first-try score and a **Practice Again** button.',
            'When every Checkpoint is done, the **Verbal Practice** step at the end unlocks.',
          ],
          tips: [
            'Checkpoints open strictly in order: "Complete Checkpoint 2 to unlock." means finish Checkpoint 2 first.',
            'The first-try score pill is green at 85% or more, amber at 70% or more.',
            'The **Path to certification** panel lists what is left: "Finish every Checkpoint" and "Pass every Verbal Practice scenario".',
          ],
        },
        {
          id: 'checkpoints',
          title: 'Checkpoints: Briefing Cards and Drills',
          what: 'A Checkpoint teaches a few Playbook rules with Briefing Cards, then checks them with short Drills. You finish it by getting every Drill right; missed Drills come back until you clear them.',
          when: 'To learn a campaign, one Checkpoint at a time. Most take a few minutes.',
          steps: [
            'Read each Briefing Card: headline, **Key Rule**, and the **Do** / **Don\'t** lists. Select **Next** (or press → or Enter).',
            'On the last card, select **Start Drills**.',
            'Answer the Drill and select **Check** (or press Enter).',
            'Read the feedback. If it says **Review Rule**, read the correct answer: that Drill comes back at the end for another try.',
            'Select **Continue**, and on the last Drill **Finish Drills**.',
            'On the **Checkpoint Complete** screen, select **Next Checkpoint**, or **Go to Verbal Practice** after the last one.',
          ],
          tips: [
            'Drill types: **Scenario Choice**, **Spot the Violation**, **Call-Flow Order**, **Match Pairs** and **Complete the Script**. Number keys pick answers.',
            'Select **Source: Playbook p. N** (or press Space) to see where a rule comes from.',
            'XP: 15 for each first-try correct answer, 5 for a corrected one, plus 50 for finishing. XP is given only the first time; **Practice Again** gives no XP.',
            'To leave mid-way, select the X at the top left. A Checkpoint you leave starts from the beginning next time.',
          ],
        },
        {
          id: 'verbal-practice',
          title: 'Verbal Practice',
          what: 'Verbal Practice is a practice call with an AI caller. You answer in your own words, typed or dictated, and get a scorecard on what you said and which Playbook rules you followed.',
          when: 'After every Checkpoint in a Track is done. Passing every scenario is the last step to certification.',
          steps: [
            'On the Track Map, select **Start** next to a Verbal Practice scenario.',
            'Read the **Scenario brief** and the account on file, then select **Start Verbal Practice**.',
            'Type your reply in the box (Enter sends, Shift+Enter adds a line), or select the mic to dictate and then send.',
            'Keep going until the caller wraps up or you reach the turn limit.',
            'Select **Finish & Grade Practice**. Grading can take up to a minute.',
            'Read the scorecard: **Strengths**, **Focus Next Time** and **What to fix** (with "Try saying"). Select **Try again** if you did not pass.',
          ],
          tips: [
            'You pass at the score shown ("Pass at 80%", for example). Breaking a critical rule is an **Automatic Fail**, whatever the score.',
            'If the mic is blocked, allow it in your browser\'s site settings, or just type. Typing always works.',
            'You can do up to 15 Verbal Practice sessions a day. Sessions you leave before your first reply do not count.',
            'If the AI coach is unavailable, your call is saved as "scorecard pending" and a Trainer can score it.',
            'If you leave and come back, select **Resume verbal practice** to pick up where you stopped.',
          ],
        },
        {
          id: 'certification',
          title: 'Getting certified',
          what: 'You are certified on a Track when every Checkpoint is complete and every Verbal Practice scenario is passed on its current version.',
          when: 'Check the **Path to certification** panel on the Track Map to see what is left.',
          steps: [
            'Finish every Checkpoint in the Track.',
            'Pass every Verbal Practice scenario.',
            'The Track card on Home shows **Certified**, and the Track Map shows **Campaign Certified**.',
          ],
          tips: [
            'Keep-Sharp reviews keep rules fresh but do not affect certification.',
            '**Recertify** means the Track changed in a way that needs a new pass. Your old certification stays in your history.',
            '**Revoked** means a Trainer withdrew your certification on that Track. The reason shows in **Path to certification**. It does not come back by itself, even if you redo the Track, so talk to your supervisor.',
            'Certification shows training is done. Your supervisor decides when you take live calls.',
          ],
        },
      ],
    },
    {
      id: 'keeping-sharp',
      title: 'Keeping sharp',
      sections: [
        {
          id: 'keep-sharp-review',
          title: 'Keep-Sharp Review',
          what: 'Short recall Drills on rules you already learned, spaced out at about 1, 3 and 7 days so they stick.',
          when: 'Whenever Home or the Track Map says reviews are due. A few minutes a day keeps your streak going.',
          steps: [
            'Select **Retention** in the sidebar, or **Start Keep-Sharp Review** on Home.',
            'Select **Start Due Review**. With several Tracks, pick a Track pill first to review only that one.',
            'Answer each Drill and select **Next Review Drill**, then **Finish Review**.',
          ],
          tips: [
            'Nothing due? **Practice Upcoming Drills** lets you review early.',
            'A wrong answer comes back in about 4 hours.',
            'No reviews yet means you have not finished a Checkpoint. Reviews start after your first one.',
            'Reviews keep rules fresh. They do not count toward certification, and skipping them never removes it.',
          ],
          links: [{ label: 'Open Keep-Sharp Review', href: '/learn/review' }],
        },
        {
          id: 'readiness-passport',
          title: 'My Readiness Passport',
          what: 'Your own record: XP, streak, certifications, skill radar, first-try Drill accuracy against Verbal Practice scores, and your graded practice transcripts with coaching.',
          when: 'To see your strengths and where to focus, or to show your supervisor your progress.',
          steps: [
            'On Home, select **My Readiness Passport**.',
            'Scroll to **Verbal Practice transcripts** to reread a call and its scorecard.',
          ],
          tips: ['Only you, your supervisor and LogiCall staff can see your Passport.'],
          links: [{ label: 'Open my Passport', href: '/analytics/agents/:uid' }],
        },
        accountMenuSection,
      ],
    },
  ],
};
