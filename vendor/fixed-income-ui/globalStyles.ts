import { createGlobalStyle } from 'styled-components'

export default createGlobalStyle`
  /* Single source of truth for corner radii — every component references these
     via var(--radius-*) (or the ds.radius tokens, which resolve to them).
     Tune the whole app's roundness here. Mirrors the design bundle's scale. */
  :root {
    --radius-xs: 2px;
    --radius-sm: 3px;
    --radius-md: 4px;
    --radius-lg: 6px;
    --radius-pill: 100px;
    --radius-full: 999px;

    /* Page content max-width — single source for the nav, announcement, header,
       page body and the create-vault wizard so they stay aligned. Narrowed from
       1600px: at that width text columns ran past a comfortable measure on a
       large display and content drifted away from the nav above it. */
    --page-max-width: 1250px;

    /* Outermost page gutter — single source so the nav and the page body share
       one config and never drift out of alignment. Tuned so the side gutter and
       the nav->content top gap read as one consistent inset. */
    --page-padding-x: 20px;

    /* Line / border colors — single source for hairlines and outlines.
       --line: default hairline · --line-strong: outlined controls / hover ·
       --line-faint: subtle internal dividers. */
    --line: #2a2422;
    --line-strong: #3a302c;
    --line-faint: #1a1717;

    /* Height of the fixed BottomNav — 0 on wide screens where it is hidden.
       Single source for the bar itself, the page's bottom padding, and
       anything that has to sit above it. The breakpoints below mirror
       MEDIUM_WIDTH / SMALL_WIDTH in shared/styles/constants.ts (the literals
       are needed because this block is plain CSS text). */
    --bottom-nav-height: 0px;

    /* Contract with the agent chat widget (apps/agent-widget/src/embed.ts):
       its launcher and panel are fixed to the viewport bottom inside a shadow
       root we cannot style, so it reads these three properties instead. The
       inset clears whatever the host has pinned down there — for us, the
       BottomNav. Gap and launcher size are left at the widget's defaults on
       wide screens and tightened below, where the bar makes the corner busy. */
    --saffron-chat-inset-bottom: var(--bottom-nav-height);
  }

  @media (max-width: 1300px) {
    :root {
      --bottom-nav-height: 64px;
      --saffron-chat-gap: 10px;
    }
  }

  @media (max-width: 800px) {
    :root {
      --page-padding-x: 16px;
      --bottom-nav-height: 56px;
      /* 44px is the smallest comfortable touch target (Apple HIG); the widget
         defaults to 56px, which crowds the corner above the bar. */
      --saffron-chat-launcher-size: 44px;
    }
  }

  /* The widget's launcher is fixed at z-index 2147483000 inside its shadow root,
     which no app-rendered overlay can out-stack. Three things need it out of the
     way, and each flags itself on <body>:
       data-nav-drawer-open  the mobile nav drawer, while open (Sidebar.tsx) —
                             the launcher otherwise floats over the panel.
       data-modal-open       the shared Modal, which keeps a ref count so nested
                             dialogs do not reveal it prematurely (Modal.tsx).
       data-fullscreen-flow  a full-screen takeover route (App.tsx), e.g. the
                             create-vault wizard, which hides the nav and footer
                             and owns the whole viewport including its own
                             sticky action bar for the launcher to collide with.
     In every case the widget's own fullscreen panel cannot be open anyway. */
  body[data-nav-drawer-open] [data-saffron-chat-root],
  body[data-modal-open] [data-saffron-chat-root],
  body[data-fullscreen-flow] [data-saffron-chat-root] {
    display: none;
  }

  html,
  body {
    background-color: ${(props) => props.theme.colors.background.base};
    padding: 0;
    margin: 0;
    font-family: ${(props) => props.theme.fonts.body};
    text-rendering: optimizeLegibility !important;
    -webkit-font-smoothing: antialiased !important;
    -moz-osx-font-smoothing: grayscale !important;
  }

  body {
    /* No large bottom padding — it left a big empty gap below the footer. The
       app Body adds its own bottom padding on mobile to clear the fixed
       BottomNav. */
    padding: 0;
  }

  a {
    text-decoration: none;
  }

  /*
    Use a more-intuitive box-sizing model.
  */
  *, *::before, *::after {
    box-sizing: border-box;
  }

  /*
    Improve media defaults
  */
  picture, video, canvas {
    display: block;
    max-width: 100%;
  }
  /*
    Remove built-in form typography styles
  */
  input, button, textarea, select {
    font: inherit;
  }
  /*
    Avoid text overflows
  */
  p, h1, h2, h3, h4, h5, h6 {
    overflow-wrap: break-word;
  }
  /*
    Create a root stacking context
  */
  #root, #__next {
    isolation: isolate;
  }

  @font-face {
    font-family: "Work Sans";
    src: url(./shared/assets/fonts/WorkSans-VariableFont_wght.ttf)
      format("truetype");
    /* other formats include: 'woff2', 'truetype, 'opentype',
                                'embedded-opentype', and 'svg' */
  }

  code {
    font-family: source-code-pro, Menlo, Monaco, Consolas, "Courier New",
      monospace;
  }
`
