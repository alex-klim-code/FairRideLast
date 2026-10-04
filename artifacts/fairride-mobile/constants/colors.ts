/**
 * Semantic design tokens for the mobile app.
 *
 * These tokens mirror the naming conventions used in web artifacts (index.css)
 * so that multi-artifact projects share a cohesive visual identity.
 *
 * Replace the placeholder values below with values that match the project's
 * brand. If a sibling web artifact exists, read its index.css and convert the
 * HSL values to hex so both artifacts use the same palette.
 *
 * To add dark mode, add a `dark` key with the same token names.
 * The useColors() hook will automatically pick it up.
 */

const colors = {
  light: {
    // Legacy aliases (kept for backward compatibility)
    text: '#203e32',
    tint: '#1e6854',

    // Core surfaces
    background: '#f5f3ec',
    foreground: '#203e32',

    // Cards / elevated surfaces
    card: '#fbfaf6',
    cardForeground: '#203e32',

    // Primary action color (buttons, links, active states)
    primary: '#1e6854',
    primaryForeground: '#fbf8ef',

    // Secondary / less-emphasis interactive surfaces
    secondary: '#1e302a',
    secondaryForeground: '#fbf8ef',

    // Muted / subdued elements (dividers, timestamps, placeholders)
    muted: '#efeee8',
    mutedForeground: '#66736b',

    // Accent highlights (badges, selected items, focus rings)
    accent: '#d28d49',
    accentForeground: '#203e32',

    // Destructive actions (delete, error states)
    destructive: '#aa5043',
    destructiveForeground: '#ffffff',

    // Borders and input outlines
    border: '#e8e4d9',
    input: '#e8e4d9',
    // Chrome passenger UI parity tokens
    inputBg: '#fffefa', eyebrow: '#71847b', btnSecondary: '#e7eee8', btnSecondaryFg: '#245d4c',
    quietBorder: '#dedfd5', yellow: '#f5c542', amber: '#e6b65e',
    okBg: '#e4efe6', okFg: '#235a46', alertBg: '#f5e5e1', alertFg: '#8f4338',
    noticeBg: '#f6efdf', noticeFg: '#7a6136', rideCard: '#143f33', walletA: '#1c5947',
    ticketBg: '#f1f6ef', ticketBorder: '#9fbfae', grCard: '#232326', grHead: '#1d1d20',
    grToggle: '#2b2b2f', grText: '#f2f2f0', grSoft: '#d6d6d2', grDim: '#a9a9a5', grLine: '#38383c',
    depGreen: '#12945f', arrBlue: '#1479c4', activeGreen: '#3fb37f', link: '#8fd0ff', pos: '#21644e', neg: '#a64f43',
  },

  // Border radius (in px). Sync from the sibling web artifact's --radius
  // CSS variable. This value applies to cards, buttons, inputs, and modals.
  radius: 17,
};

export default colors;
