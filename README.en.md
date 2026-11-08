# Job Search Team

**A portable agent skill for finding jobs, evaluating evidence, and applying with your authorization.**

Includes a local browser assistant for BOSS Zhipin and Liepin. Configure scoring weights, veto rules, recruiter activity and job freshness. Run with multiple agents or one model working through the roles sequentially.

[Latest skill V2.1](releases/job-search-team-V2.1.zip) · [Version map](VERSION_HISTORY.md) · [Standalone assistant V2.0](releases/resume-browser-assistant-V2.0.zip) · [Chrome extension only](releases/resume-browser-extension-V2.0.zip) · [Setup guide (Chinese)](job-search-team/references/setup.md) · [中文](README.md)

The latest update adds a private problem-file workflow: read at startup, consult before recovery, and update both the problem file and local knowledge base after each result or user correction. A consent-based initializer creates empty files and a session handoff entry without overwriting existing history. Recruiter-interest tracking and 20-job reviews remain. The original [V2.0 archive](releases/job-search-team-V2.0.zip) is preserved; browser-assistant runtime code is unchanged.

## Why use it?

- Adjustable scores for fit, growth, salary versus living costs, employee reviews and industry reputation.
- User-confirmed veto rules and separate recruiter activity, job update and posting-date filters.
- Evidence-aware results: missing information stays unknown instead of becoming a fabricated score.
- Clear ownership of browser tabs, files, communication and application receipts.
- Bundled extension, local service and CLI; no author-specific paths or credentials.
- Model-provider independent instructions and a single Node.js runtime dependency.
- Optional local incident and human-intervention records, consulted before recovery; declining the knowledge base does not block use.
- Evidence-based recruiter interest and a focused list of opportunities with next steps.
- A read-only attitude review every 20 contacted jobs, including greeting-only contacts, without counting later resume sends again.

## Quick start

1. Privately provide your resume, target roles, scoring weights, vetoes and scoped permissions. Reuse valid existing answers. Then extract the complete skill package. Install Node.js 22+ and a desktop Chromium-compatible browser that permits local extensions. Create a writable workspace.
2. Run, substituting actual paths:

```sh
node "<skill-directory>/scripts/ensure-assistant.mjs" --workspace "<workspace>"
```

3. Load the extension from the printed directory, import the generated pairing file and sign in to the recruiting platform. Verify the connection, account, tab permissions and a read-only snapshot.
4. Run the [acceptance checklist](job-search-team/references/acceptance.md). Record untested and blocked functions. Do not send test messages or resumes to real recruiters; verify outbound actions only during an authorized actual task.

No Python or npm packages are required. The current detailed skill instructions and setup guide are in Chinese.

After the user authorizes private knowledge retention, run:

```sh
node "<skill-directory>/scripts/init-knowledge.mjs" --workspace "<private-workspace>" --enable
```

Use `--knowledge-dir "<workspace-relative-directory>"` to reuse an existing knowledge directory. Declining retention does not block the skill. Import the complete archive in another session and follow the [handoff guide](job-search-team/references/session-handoff.md). Project instructions are an agent workflow, not a background logging service. Private history must be supplied separately by its owner, never bundled into the public skill.

## Validation and limits

The source and independently extracted ZIP each pass 101 local tests, including 7 new knowledge-initialization tests for consent, preservation, idempotence, directory boundaries and standalone CLI use. New environments still require browser acceptance checks.

The new offline review planner passes 8 behavioral tests. Pending opportunities leave routine review after more than three days if read without any recruiter reply, or after more than seven days regardless of read status. Later incoming messages are still handled. The planner does not operate recruiting websites or infer real interest without conversation evidence.

V2.0 has 86 passing local automated tests: 77 bridge/visual logic tests, 7 scoring tests and 2 deployment/reuse tests. See the [validation report](job-search-team/VALIDATION.md) for extracted-package checks. Tested on Windows, including blank workspaces and paths with spaces and Chinese characters. Browser API and DOM tests are simulated; this is not a claim of live compatibility with every operating system, host or future website version.

The assistant can capture Chrome’s active tab and switch authorized recruiting tabs without reloading. Minimized captures may be stale or fail; check current conversation and text receipts. The extension supplies images, not an embedded vision model. Attachment-request receipts can count as delivery if the user chooses that metric; retain the original state and do not infer acceptance or reading.

Automatic website operation needs tools running on the same machine as the browser, or an authorized local tool connection. A cloud-only chat cannot directly access your machine's loopback service. First-time extension installation, account login and verification may require user action. This project does not promise job offers or unattended operation.

Never commit your runtime `.local` directory, tokens, resume, private conversations, local solution knowledge base or recruiter-interest tracking state. Report reproducible issues with sensitive details removed.

If useful, star the repository or share it with someone looking for their next role.

Licensed under the [MIT License](LICENSE).

## Community Interaction

This project acknowledges and supports the [LINUX DO Community](https://linux.do/).
Feel free to visit the community to discuss open source and technology.
