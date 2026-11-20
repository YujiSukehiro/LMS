/** Plain-language reason a dictation attempt stopped, or null when there is nothing to tell the learner. */
export function voiceErrorMessage(code: string | undefined): string | null {
  switch (code) {
    case 'not-allowed':
    case 'service-not-allowed':
      return 'Microphone access is blocked. Allow it in your browser’s site settings, or type your reply.';
    case 'audio-capture':
      return 'No microphone was found. Connect one, or type your reply.';
    case 'network':
      return 'Voice dictation needs an internet connection. Type your reply instead.';
    case 'no-speech':
      return 'Didn’t catch that. Select the mic and try again.';
    case 'aborted':
    case undefined:
      return null;
    default:
      return 'Voice dictation stopped. Type your reply or try the mic again.';
  }
}
