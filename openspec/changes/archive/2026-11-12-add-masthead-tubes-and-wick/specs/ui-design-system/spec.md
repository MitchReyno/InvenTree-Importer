# Capability delta

## ADDED Requirements

### Requirement: Vacuum tubes in the electronics current

The electronics current SHALL include an octal vacuum tube, a 5U4 rectifier and a Nixie tube among its drifting parts, re-tinted with the theme like the existing parts.

- The glass tubes SHALL show their internal structure through translucent glass, with a warm heater glow.
- The Nixie tube SHALL count 0–9 on stacked numerals, with the lit numeral drawn thicker and never hidden by the unlit ones.

#### Scenario: Nixie numeral stays readable

- **GIVEN** a Nixie tube in the current
- **WHEN** its count moves to the next numeral
- **THEN** exactly that numeral is lit and drawn thick, and every other numeral stays thin and unlit.

#### Scenario: Tubes in the dark theme

- **GIVEN** the dark theme
- **WHEN** a tube is in the current
- **THEN** it uses the dark finish like the existing parts.

### Requirement: Solder wick with a hanging loose end

The electronics current SHALL include a solder wick dispenser. Its loose end SHALL hang under gravity from the rim, follow the dispenser as it moves and turns, react to the pointer, and be released with its dispenser.

#### Scenario: Loose end hangs and follows the dispenser

- **GIVEN** a solder wick dispenser in the current
- **WHEN** it drifts and turns, or the pointer passes over its loose end
- **THEN** the end stays attached to the rim at its fixed length, swings and settles under gravity, and keeps finite positions.

#### Scenario: Loose end leaves with its dispenser

- **GIVEN** a dispenser leaving the masthead, or the masthead unmounting
- **WHEN** the dispenser is recycled or the current is disposed
- **THEN** its loose end is removed from the scene and its geometry is released.

#### Scenario: Still frame

- **GIVEN** reduced motion
- **WHEN** the masthead renders its still frame
- **THEN** the loose end hangs straight down from the rim.
