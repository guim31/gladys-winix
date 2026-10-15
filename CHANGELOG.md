# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

### Added

- Winix connected air purifiers in Gladys, through the Winix cloud: one
  device per purifier of the account, with power, mode (Auto, Manual, Sleep),
  fan speed and Plasmawave to control, air pollution (the Winix color ring),
  PM2.5 and ambient light on the models that measure them, filter life and
  filter hours left, and whether the purifier is online.
- Sign-in with the e-mail address and password of the Winix account. The
  session is kept in `/data`: a restart does not sign in again, and reading
  or controlling the purifiers keeps working when the phone app takes the
  Winix session back. A refused password is reported in the Configuration
  screen and not retried until it changes.
- The purifiers refresh every 1 to 5 minutes (2 by default) on their own,
  even when Gladys does not poll them, and right after each command.
- Dashboard widget "Winix purifier": PM2.5, filter, mode and air quality of
  one purifier, with Auto, Manual, Sleep and Turn off buttons.
- Every text in English, French, German and Spanish, and the user guide in
  the four languages.

[Unreleased]: https://github.com/guim31/gladys-winix/commits/main
