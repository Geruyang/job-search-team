# Job Search Team

**A portable agent skill for finding jobs, evaluating evidence, and applying with your authorization.**

Includes a local browser assistant for BOSS Zhipin and Liepin. Configure scoring weights, veto rules, recruiter activity and job freshness. Run with multiple agents or one model working through the roles sequentially.

[Download the skill](releases/job-search-team-portable-20261030-standalone.zip) · [Setup guide (Chinese)](job-search-team/references/setup.md) · [中文](README.md)

## Why use it?

- Adjustable scores for fit, growth, salary versus living costs, employee reviews and industry reputation.
- User-confirmed veto rules and separate recruiter activity, job update and posting-date filters.
- Evidence-aware results: missing information stays unknown instead of becoming a fabricated score.
- Clear ownership of browser tabs, files, communication and application receipts.
- Bundled extension, local service and CLI; no author-specific paths or credentials.
- Model-provider independent instructions and a single Node.js runtime dependency.

## Quick start

1. Extract the complete skill package. Install Node.js 22+ and a desktop Chromium-compatible browser that permits local extensions. Create a writable workspace.
2. Run, substituting actual paths:

```sh
node "<skill-directory>/scripts/ensure-assistant.mjs" --workspace "<workspace>"
```

3. Load the extension from the printed directory, import the generated pairing file and sign in to the recruiting platform. Verify the connection, account, tab permissions and a read-only snapshot.
4. Give your agent the skill and your own resume. Confirm preferences before final selection; authorize outbound communication separately.

No Python or npm packages are required. The current detailed skill instructions and setup guide are in Chinese.

## Validation and limits

76 tests passed from an independently extracted archive outside the original project: 67 bridge tests, 7 scoring tests and 2 deployment/reuse tests. Tested on Windows, including blank workspaces and paths with spaces and Chinese characters. Browser API and DOM tests are simulated; this is not a claim of live compatibility with every operating system, host or future website version.

Automatic website operation needs tools running on the same machine as the browser, or an authorized local tool connection. A cloud-only chat cannot directly access your machine's loopback service. First-time extension installation, account login and verification may require user action. This project does not promise job offers or unattended operation.

Never commit your runtime `.local` directory, tokens, resume or private conversations. Report reproducible issues with sensitive details removed.

If useful, star the repository or share it with someone looking for their next role.

Licensed under the [MIT License](LICENSE).
