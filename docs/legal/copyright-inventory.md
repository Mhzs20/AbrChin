# Copyright and attribution inventory

This inventory is evidence for Work Package 4. **It does not invent a
repository license.** `package.json` has `"private": true` and there is no root
`LICENSE` file.

## Owner decision required

Choose and record an SPDX identifier for AbrChin source (for example MIT,
Apache-2.0, or proprietary / all-rights-reserved). Until that decision, do not
claim the project is open source or that a specific license applies to first-party
code.

## Bundled fonts

| Asset | Path | License evidenced |
| --- | --- | --- |
| Mikhak DS1 Medium | `public/assets/fonts/Mikhak-DS1-Medium.ttf` | SIL OFL 1.1 (`public/assets/fonts/OFL.txt`) |
| Mikhak DS1 Black | `public/assets/fonts/Mikhak-DS1-Black.ttf` | SIL OFL 1.1 (`public/assets/fonts/OFL.txt`) |

Referenced from `app/globals.css` `@font-face`.

## First-party graphics

| Asset | Path | Notes |
| --- | --- | --- |
| Wordmark | `public/assets/abrchin-logo.svg` | AbrChin master artwork |
| Symbol | `public/assets/abrchin-symbol.svg` | AbrChin master artwork |
| Layered master | `public/assets/AbrChin-master-layered(1).svg` | AbrChin master artwork |
| System icons | `public/assets/abrchin-system/icons/*.svg` | First-party SVGs; no third-party license header |

## Direct production dependencies

Licenses taken from each package's `package.json` `license` field at the
versions pinned in this repository:

| Package | Version | License |
| --- | --- | --- |
| next | 16.2.11 | MIT |
| react | 19.2.7 | MIT |
| react-dom | 19.2.7 | MIT |
| lucide-react | 1.25.0 | ISC |
| motion | 12.42.2 | MIT |
| nodemailer | 9.0.5 | MIT-0 |
| @prisma/client | 6.19.3 | Apache-2.0 |
| server-only | 0.0.1 | MIT |

Transitive dependency licenses are not exhaustively listed here. Regenerating
this inventory after a lockfile change is an owner/ops task.

See `NOTICE` for the copy shipped with the tree.
