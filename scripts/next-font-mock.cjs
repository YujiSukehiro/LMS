/**
 * Hermetic mock for Next.js `NEXT_FONT_GOOGLE_MOCKED_RESPONSES` during offline CI / verification loops.
 * Production builds without `NEXT_FONT_GOOGLE_MOCKED_RESPONSES` continue fetching real Google Fonts.
 */
module.exports = new Proxy(
  {},
  {
    get(_target, prop) {
      if (typeof prop !== 'string' || !prop.startsWith('http')) return undefined;
      const isMono = prop.includes('JetBrains');
      const family = isMono ? 'JetBrains Mono' : 'Plus Jakarta Sans';
      return `/* latin */
@font-face {
  font-family: '${family}';
  font-style: normal;
  font-weight: 400 800;
  font-display: swap;
  src: url(https://fonts.gstatic.com/s/mock/${isMono ? 'jetbrains-mono' : 'plus-jakarta-sans'}.woff2) format('woff2');
}`;
    },
  },
);
