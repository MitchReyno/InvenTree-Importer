# Capability delta

## MODIFIED Requirements

### Requirement: Masthead and electronics current in both themes

The masthead SHALL be one bar with the electronics current placed by the operator's masthead style: in the bar (option A, the default), behind the whole window (option B), or in a band at the top of the page that fades down (option C). Every style SHALL follow the theme setting. The current SHALL keep its existing behaviour in every style: WebGL 2 detection, lazy loading, reduced-motion still frame, pointer stir, LED pulse and display cycling. It SHALL have a dark finish (outline, crease and fill tints) used under the dark theme, with outlines at least 3:1 against the masthead ground.

- In the bar (A), the bar carries the dotted masthead ground and parts show only in the gap between the bar's text; at compact width, where the gap is small, parts under the text dim to a quarter strength instead of disappearing, as today.
- Behind the whole window (B), the dotted masthead ground covers the window and the current stays fixed to the viewport. The bar is a translucent, blurred surface with a bottom rule. Cards are raised with the elevated shadow. Each heading, and any other text, that sits directly on the field has a patch of the masthead ground behind it, so parts pass behind the patch rather than the text.
- Fading down (C), the dotted ground and the current fill a band at the top of the page that is fully visible to 140px and fades to the page background by 420px, scrolling away with the page. The bar has no ground or rule of its own. Within the bar's height, parts follow the same text-gap rule as In the bar; below the bar, parts stay out of the main content column, so page headings, navigation and leads in the band never have parts behind them.
- Part density SHALL follow the area the current covers, so a whole-window field is no denser than the bar, within a fixed upper limit on parts.

#### Scenario: Dark masthead

- **GIVEN** the dark theme, the In the bar style and a window wider than the compact breakpoint
- **WHEN** the masthead renders with WebGL 2 available
- **THEN** the parts use the dark finish on the dark masthead ground, remain visible, and never overlap header text.

#### Scenario: Default style is unchanged

- **GIVEN** a device with no stored masthead style
- **WHEN** any screen renders
- **THEN** the masthead uses the In the bar style, exactly as before this change.

#### Scenario: Behind the whole window

- **GIVEN** the Behind the whole window style on a 1440 × 900 window with WebGL 2 available
- **WHEN** the Batches screen renders and the operator scrolls
- **THEN** the dotted ground and parts fill the window behind the content and stay in place while content scrolls; the bar is translucent; cards show the elevated shadow; and the "Batches" heading sits on a ground patch, so it keeps at least 4.5:1 contrast whatever part passes behind it.

#### Scenario: Behind the whole window in the dark theme

- **GIVEN** the Behind the whole window style and the theme setting Dark
- **WHEN** any screen renders with WebGL 2 available
- **THEN** the dark masthead ground fills the window, the parts use the dark finish with LEDs and displays still glowing, and the heading patches use the dark ground.

#### Scenario: Headings inside surfaces get no patch

- **GIVEN** the Behind the whole window style
- **WHEN** a card heading or the batch header's title renders
- **THEN** it shows no ground patch, because it already sits on a surface.

#### Scenario: Compact width keeps its dimming

- **GIVEN** a 390px-wide window, the In the bar or Fading down style, and either theme
- **WHEN** the masthead renders with WebGL 2 available
- **THEN** parts in the bar's gap show at full strength and parts under the bar's text show at a quarter strength, as In the bar does before this change, and Fading down draws no parts behind page text below the bar.

#### Scenario: Fading down

- **GIVEN** the Fading down style on Settings, in a window wider than the compact breakpoint, where the title, nav and section lead sit within the band
- **WHEN** the screen renders and then scrolls down past 420px
- **THEN** the band shows the dotted ground and parts behind the bar and in the side margins, fades to the page background by 420px, no part is drawn behind the bar's text or the page's text, and the band scrolls away with the page.

#### Scenario: No WebGL 2 or reduced motion

- **GIVEN** any style, in a browser without WebGL 2, or with reduced motion requested
- **WHEN** the screen renders
- **THEN** the style's ground, bar and card treatment still apply; without WebGL 2 no parts are drawn and three.js is not downloaded; with reduced motion the parts show as a still frame.

#### Scenario: Style changes in place

- **GIVEN** the current running in one style
- **WHEN** the operator picks another style
- **THEN** the new style applies without a page reload, the previous canvas and its parts are released, and no second animation loop keeps running.
