/**
 * Sections more than one guide uses (sign-in, account, the Guide itself). Change them here once.
 */
import type { GuideSection } from './types';

export const signInSection = (audience: 'agent' | 'staff'): GuideSection => ({
  id: 'sign-in',
  title: 'Sign in',
  what:
    audience === 'agent'
      ? 'Pulse is invite-only. You sign in with your LC Number and password, with a LogiCall Google account, or with the setup link or Cohort join code your supervisor or LogiCall gave you.'
      : 'Pulse is invite-only. LogiCall staff sign in with Google; everyone else needs an invite setup link (email) or, for LC Number agents, an account from Bulk Import or a Cohort join code.',
  when: 'Every time you open Pulse, and the first time you set up your account.',
  steps:
    audience === 'agent'
      ? [
          'Open the Pulse sign-in page.',
          'With an LC Number: type it (for example LC-1042) in **LC Number or Email**, type your **Password**, then select **Sign In**.',
          'With a LogiCall Google account (@logicall.io or @logicall.live): select **Continue with Google**.',
          'First time with an invite email: open the setup link, choose a password (at least 10 characters) and select **Create my account**, or select **Use my Google account**.',
          'First time with a join code: select **Have a Team Join Code? Claim Access**, type the code (for example THS-7842), select **Continue**, fill in **Full Name**, **LC Number** and a password (at least 10 characters), then select **Create Account & Sign In**.',
          'Given a temporary password (a new account from your supervisor or LogiCall, or after a reset): sign in with it, then type your own password twice on **Choose a new password** and select **Save password and continue**.',
        ]
      : [
          'LogiCall staff: select **Continue with Google** and pick your @logicall.io or @logicall.live account.',
          'Invited by email: open the one-time setup link from the invite email, choose a password (at least 10 characters) and select **Create my account**, or select **Use my Google account** for that same address.',
          'Accounts with a password: type your LC Number or email in **LC Number or Email**, your **Password**, then select **Sign In**.',
          'Signed in with a temporary password (from Bulk Import or a reset)? Pulse opens **Choose a new password** first. Pick one with at least 10 characters.',
        ],
  tips: [
    'A Google account outside @logicall.io and @logicall.live is refused unless it was invited first.',
    audience === 'agent'
      ? 'A first-time @logicall.io / @logicall.live Google sign-in starts as an Agent in the LogiCall Internal Cohort.'
      : 'A first-time @logicall.io / @logicall.live Google sign-in with no invite starts as an Agent in the LogiCall Internal Cohort. To make them staff, change their role with **Access** on the Roster, or invite them before they sign in.',
    'Passwords need at least 10 characters.',
    'Setup links work once. If yours says **Invite not available**, ask for a new one.',
    'A deactivated account cannot sign in. Contact your LogiCall administrator.',
  ],
});

export const forgotPasswordSection = (audience: 'agent' | 'staff'): GuideSection => ({
  id: 'forgot-password',
  title: 'Forgot your password',
  what: 'How you get back in depends on how you sign in: LC Number agents get a temporary password from a person; email accounts get a reset link; Google accounts reset with Google.',
  when: 'When your password does not work.',
  steps: [
    'On the sign-in page, type your LC Number or email first, then select **Forgot password?**.',
    'LC Number: the page tells you to ask your supervisor or LogiCall admin for a temporary password. They issue it from Pulse.',
    'Email: select **Send reset link** and follow the link in your inbox.',
    'Sign in with the temporary password. Pulse opens **Choose a new password**: type a new password (at least 10 characters) twice and select **Save password and continue**.',
  ],
  tips: [
    'You cannot skip the new-password step: every page sends you back to it until you save.',
    'Google sign-in accounts have no Pulse password. Reset it with Google.',
    ...(audience === 'staff' ? ['To issue a temporary password to someone else, see "Reset a password".'] : []),
  ],
});

export const accountMenuSection: GuideSection = {
  id: 'account-menu',
  title: 'Theme, How To and signing out',
  what: 'The account menu (your initials, top right) holds the color theme, a link to this How To page, and **Sign out**.',
  when: 'When the screen is hard to read, when you need help, or on a shared computer.',
  steps: [
    'Select your initials in the top-right corner.',
    'Under **Theme**, pick **Light**, **Dark**, **Contrast** or **System**. Pulse remembers your choice.',
    'Select **How To** to open this page. **How To** is also at the bottom of the left sidebar.',
    'Select **Sign out** when you finish on a shared computer.',
  ],
  links: [{ label: 'Open How To', href: '/how-to' }],
};

/** Staff (Supervisor, Trainer, Admin) take the trainings assigned to them too: compliance applies to everyone. */
export const myTrainingsSection = (audience: 'supervisor' | 'internal'): GuideSection => ({
  id: 'my-trainings',
  title: 'Take your own trainings',
  what:
    audience === 'internal'
      ? 'Some trainings (for example compliance) are assigned to everyone, staff included. **My Trainings** lists the Tracks assigned to you through **Every Cohort**, the LogiCall Internal Cohort, or by name. Your Checkpoints, Verbal Practice and certification are recorded like any learner\'s. Track Studio test-play is a preview and does not count.'
      : 'Some trainings (for example compliance) are assigned to you as well as your agents. **My Trainings** lists the Tracks assigned to you through **Every Cohort**, your Cohort, or by name. Your progress and certification are recorded like any learner\'s.',
  when: 'When Home shows trainings still to finish, or a Trainer tells you a new training is assigned.',
  steps: [
    'Select **My Trainings** in the side menu, or **Open My Trainings** on Home.',
    'Select a Track card, then work through its Checkpoints in order.',
    'Pass Verbal Practice at the end of the Track to get certified.',
  ],
  links: [{ label: 'Go to My Trainings', href: '/learn' }],
});
