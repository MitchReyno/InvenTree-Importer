# Capability delta

## MODIFIED Requirements

### Requirement: Masthead and electronics current in both themes

The masthead SHALL be one bar with the electronics current placed by the operator's masthead style: in the bar (option A, the default), behind the whole window (option B), or in a band at the top of the page that fades down (option C). Every style SHALL follow the theme setting. The current SHALL keep its existing behaviour in every style: WebGL 2 detection, lazy loading, reduced-motion still frame, pointer stir, LED pulse and display cycling. It SHALL have a dark finish (outline, crease and fill tints) used under the dark theme, with outlines at least 3:1 against the masthead ground.

- In the bar (A), the bar carries the dotted masthead ground and parts show only in the gap between the bar's text.
- Behind the whole window (B), the dotted masthead ground covers the window and the current stays fixed to the viewport. The bar is a translucent, blurred surface with a bottom rule. Cards are raised with the elevated shadow. Each heading, and any other text, that sits directly on the field has a patch of the masthead ground behind it, so parts pass behind the patch rather than the text.
- Fading down (C), the dotted ground and the current fill a band at the top of the page that is fully visible to 140px and fades to the page background by 420px, scrolling away with the page. The bar has no ground or rule of its own, and parts within the bar's height show only in the gap between its text.
- Part density SHALL follow the area the current covers, so a whole-window field is no denser than the bar, within a fixed upper limit on parts.

#### Scenario: Dark masthead

- **GIVEN** the dark theme and the In the bar style
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

#### Scenario: Fading down

- **GIVEN** the Fading down style
- **WHEN** a screen renders and then scrolls down past 420px
- **THEN** the band shows the dotted ground and parts at full strength behind the bar, fades to the page background by 420px, no part overlaps the bar's text, and the band scrolls away with the page.

#### Scenario: No WebGL 2 or reduced motion

- **GIVEN** any style, in a browser without WebGL 2, or with reduced motion requested
- **WHEN** the screen renders
- **THEN** the style's ground, bar and card treatment still apply; without WebGL 2 no parts are drawn and three.js is not downloaded; with reduced motion the parts show as a still frame.

#### Scenario: Style changes in place

- **GIVEN** the current running in one style
- **WHEN** the operator picks another style
- **THEN** the new style applies without a page reload, the previous canvas and its parts are released, and no second animation loop keeps running.
