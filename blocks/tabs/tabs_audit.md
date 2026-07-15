# `.tabs (.tabs.auth-track)` Full Spec

Found on both pages you referenced.

Note upfront: the page also has an unrelated `.tabs.tabs-vertical` in the global header mega-menu. It uses identical markup on both pages, byte-for-byte, but it is a different, separately built widget: a roving tab list for the "Business Segments" dropdown. It is out of scope for this analysis and is only noted here to avoid confusion with the content component below.

Instances found:
- `Locomotive.html`: 1 instance, 2 tabs (`GBRf` / `Saudi Arabia`), each holding a `.multimedia` video gallery
- `Infrastructure.html`: 2 instances, first with 5 tabs and second with 4 tabs, containing mixed `.multimedia` video and `.texteditor` content

Both pages use the same clientlib hash (`v2`), so the component version is identical across instances.

This is built on AEM Core Components Tabs, extended with Slick carousel for horizontal overflow scrolling of the tab nav itself.

## 1. HTML Structure

```text
div.tabs[.section-padding*][.aem-GridColumn.aem-GridColumn--default--12]
  div.tabs.auth-track[data-cmp-is="tabs"]
    div.container
      div.tabs__nav[tabindex=0][aria-orientation="horizontal"]
        div.tabs__nav-item[.--active]
          [id] [role="tab"] [type="button"] [tabindex="0"/"-1"]
          [aria-controls=<panel-id>] [aria-selected="true"/"false"]
          [data-cmp-hook-tabs="tab"]
          <h3>Label</h3>
      div.tabs__content.select-text
        div.tabs__content-item[role="tabpanel"][id=<panel-id>]
          [tabindex="0"/"-1"] [aria-labelledby=<tab-id>] [aria-hidden="false"/"true"]
          -> nested component: .media-youtube > .multimedia.auth-track OR .teaser... OR .texteditor...
```

Notes:
- `div.tabs__nav` becomes Slick `.slick-list` / `.slick-track`.
- `div.tabs__content.select-text` becomes a Slick fade carousel.
- Tab buttons have solid native semantics out of the box: `role="tab"`, `role="tabpanel"`, `aria-controls`, `aria-labelledby`, `aria-selected`, and roving `tabindex`.
- Markup is identical in structure across both pages and instances, which suggests a well-templated reusable component.

### Structural quirk confirmed live

JS runs `applyTabsAccessibilityFix()` which:
- forces `role="none"` onto the `<h1>`-`<h6>` inside each tab so the heading is not redundantly announced inside the tab button
- stamps `role="tablist"` onto Slick's generated `.slick-slide` wrapper divs
- adds `aria-posinset` and `aria-setsize` to each tab

This is a post-hoc ARIA patch layered over Slick-generated markup and re-run on every `init`, `reInit`, `setPosition`, and `afterChange` event, rather than semantics being correct by construction.

## 2. CSS

Source: `tabs/v2` clientlib, 49 rules total

### Base

- `.tabs__nav` -> `display:flex`, fixed `height:78px`
- `.tabs__nav::before` uses a full-bleed `100vw` plus negative margin trick to draw a full-width line/background under the tab row
- `.tabs__nav-item` -> fixed `height:70px`, bottom border and right divider
- Active tabs render a CSS triangle via `::after`
- `.slick-arrow` is scoped two ways:
  - `.tabs > .tabs__nav .slick-arrow`
  - `.tabs .tabs__nav > .slick-list .slick-arrow`
- Arrows are circular `34x34px` and positioned at fixed `top:34px`
- Nested `.multimedia` blocks receive tabs-specific overrides, including zero left/right padding and adjusted Slick arrow positioning

### `>= 1400px`

- Tab items get `20px` left/right padding.

### `<= 1399px`

- Tab items get `min-width:140px`
- Tab items get `max-width:224px`
- Padding remains `20px`

### `<= 992px`

- Arrows shrink with `transform:scale(0.9)`
- A white glow via `box-shadow` softens clipped edges
- Nested `.multimedia` container padding is zeroed out

Note: this arrow styling is effectively dead for `.tabs__nav`, because JS disables arrows below this breakpoint. It only affects nested `.multimedia` arrows.

### `<= 767px`

- Nested `.multimedia` nav and slide padding are forced to `0`
- `.tabs .slick-list` and `.tabs .slick-track` get `min-height:330px` to prevent collapse during fade transitions on short content

### Coherence gap

No CSS media query directly controls how many tabs are shown. That logic lives in JS through Slick's responsive config.

Current breakpoint split:
- CSS: `1399px`, `992px`, `767px`
- JS: `992px`, `768px`, `492px`

These are close, but not aligned. That creates pixel ranges where visual sizing assumes one density while Slick behavior uses another.

## 3. JS Functionality

Library: jQuery + Slick, plus a hand-rolled accessibility patch layer

### Dual Slick instances

Two separate Slick instances are kept in sync:

- `.tabs__nav`
  - `slidesToShow:5`
  - `arrows:true` at `>= 993px`
  - `slidesToShow:3`, `arrows:false` at `<= 992px` and `<= 768px`
  - `slidesToShow:2`, `arrows:false` at `<= 492px`
- `.tabs__content`
  - `slidesToShow:1`
  - `fade:true`
  - `arrows:false`
  - `swipe:false`

Clicking or keying a tab calls `slickGoTo` on the content carousel to match the nav carousel's active index. The two widgets are synchronized manually through helper logic.

### Keyboard model

- On the container, `keydown` intercepts:
  - Left: `37`
  - Right: `39`
  - Home: `36`
  - End: `35`
- The handler moves between `.tabs__nav-item` controls regardless of whether they are clipped in the overflow track.
- It both activates and focuses the target tab.

This follows the ARIA APG tab-list pattern. Confirmed live: it correctly reaches and scrolls to tabs clipped out of view, including in the 5-tab instance at tablet width.

### Panel switching

Panel switching logic:
- deactivates all tabs with `aria-selected="false"` and `tabindex="-1"`
- activates the target tab with `aria-selected="true"` and `tabindex="0"`
- hides all panels with `aria-hidden="true"` and `.hide()`
- removes links and buttons in hidden panels from the tab order
- restores focusability for interactive children in the shown panel

This is a solid manual approximation of `inert` behavior for browsers that do not support native `inert`.

### Height sync

After any tab or slide change, height logic recalculates `.tabs__content` to match the active panel's real height.

Special case:
- if the active panel contains a `.multimedia` gallery, the code delegates to Slick's own `setPosition` instead of doing manual height math

### Deep-linking

- Clicking a tab rewrites the URL hash to that tab's id using `history.replaceState`
- No page jump or reload occurs
- On page load, if the current hash matches a tab id, that tab auto-activates
- The page then smooth-scrolls to it after a `1s` delay

### Responsiveness after the fact

- A debounced `window.resize` handler calls `slick("refresh")` on the nav if initialized
- A separate `orientationchange` handler does the same

This is stronger than the `.multimedia` gallery implementation, which had no resize handling, but the `500ms` debounce and additional height-sync delays can create visible settle time after resize.

### Confirmed overflow gap

At about `800px` viewport width with 5 tabs:
- only 2-3 tabs are visible in the Slick track
- no arrows render because `arrows:false` is configured at that breakpoint
- no scrollbar, fade, dot, or chevron indicates overflow

The only discovery path for remaining tabs is dragging the row. Keyboard users are fine. Pointer-only users get no visible affordance.

## Verified Gaps

- Overflow discoverability is poor at tablet widths with 4+ tabs. Hidden tabs can be clipped with no visual cue.
- CSS and JS breakpoint definitions do not share a single source of truth.
- ARIA is patched after construction instead of being authored correctly into the generated structure.
- Two independent Slick instances are manually synchronized, which increases desync risk.
- The `<= 992px` arrow shrink/glow rule is dead for `.tabs__nav` while arrows remain JS-disabled at that width.

## Recommendations

### DOM Structure

- Author ARIA roles into the Slick markup at init time instead of reapplying `applyTabsAccessibilityFix()` across multiple events.
- Add a visible and programmatic overflow indicator when the tab row contains more slides than `slidesToShow`.
- Reconsider suppressing arrows below `993px`. That breakpoint is exactly where overflow becomes more likely.
- Standardize on one shared breakpoint set across CSS and JS.

### CSS

- Remove the dead `<= 992px` arrow rule for `.tabs__nav .slick-arrow`, or restore matching JS behavior so the CSS is not orphaned.
- Deduplicate the defensive double-selector used for Slick arrows unless the DOM variation is still necessary.
- Extract the `100vw` full-bleed trick in `.tabs__nav::before` into a shared utility if the same pattern exists elsewhere.
- Reevaluate min/max tab widths against real tab-count scenarios. With 5 tabs at `max-width:224px`, the nav row alone can demand roughly `1120px` before container padding.

### JS / UX

- Merge the two Slick instances into a single source of truth where feasible, or at minimum add guardrails to detect active-index desync.
- Add a visible overflow cue for pointer users at breakpoints where arrows are off but content still overflows.
- Reduce chained `setTimeout` delays in height sync, deep-link scroll, and resize refresh in favor of event-driven triggers.
- Consider skipping Slick nav initialization entirely when tab count is less than or equal to the breakpoint's visible slot count. A 2-tab instance does not need overflow carousel machinery.
