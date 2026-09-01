# Legal entity release blocker

**Status: `BLOCKED` — not production-legal-ready**

Public contractual pages describe current product behavior. They are **not** a finalized
corporate contract until the owner supplies official identity fields.

`LEGAL_CONFIG_VERSION` lives in `lib/legal/config.ts`. Until
`isLegalLaunchReady()` is true:

- pages send `robots: noindex`;
- `/terms`, `/privacy`, `/refund-policy`, and `/service-policy` are omitted from the sitemap;
- a draft banner is shown;
- readiness `features.legalEntity` is `blocked`.

Do not treat placeholder copy as registered company facts.

## Official fields the owner must provide

| Field | Config key | Example of what is needed (do not invent) |
| --- | --- | --- |
| نام قانونی شرکت | `companyLegalName` | Official registered name |
| شماره ثبت | `companyRegistrationNumber` | Official registration number |
| شناسه ملی | `nationalId` | Official national ID |
| نشانی پستی | `postalAddress` | Official postal address |
| صلاحیت قضایی / حاکمیت | `jurisdiction` | Governing law / venue |
| وضعیت مالیاتی | `taxStatus` | Official tax posture |
| نام نماینده قانونی | `legalRepresentativeName` | Official legal representative |

Optional, also unpublished until supplied (never invent durations or SLA):

- `supportSla`
- `dataRetentionPolicy`

Public contact mailbox in code is `hello@abrchin.ir`. A separate `support@`
mailbox is not treated as operational.

After values are written into `LEGAL_ENTITY` and reviewed, re-run
`npm run test:legal-content` and confirm `isLegalLaunchReady()` before claiming
legal launch readiness.
