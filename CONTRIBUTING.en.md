# Contributing

Thanks for contributing code, documentation, or tests to EchoBench.

## First contribution: sign the CLA

Before opening your first pull request, read [CLA.md](CLA.md). EchoBench uses a CLA to make contribution rights explicit. Contributors retain copyright while granting the project the right to distribute contributions under Apache-2.0 and other terms, including a commercial license.

Sign by commenting on the PR:

```text
I have read the EchoBench CLA and I hereby sign it.

GitHub username: @your-handle
Date: YYYY-MM-DD
```

Checking the PR checklist box alone is not a signature; the PR comment is the signature. A CLA bot will post instructions when the PR is opened; copy the fixed text into a **new PR comment**, not a reply to the bot comment.

If the contribution belongs to your employer, or your employer owns intellectual property you create at work, use [CCLA.md](CCLA.md), fill in Schedule A, and have an authorized company representative sign it.

> The CLA is a general template, not legal advice. Have a lawyer review it before commercial licensing or corporate contributions.

## Development workflow

1. Fork the repository and create a feature branch from the main branch.
2. Install dependencies:

   ```bash
   npm ci
   ```

3. Run locally:

   ```bash
   npm run dev
   ```

4. Before submitting:

   ```bash
   npm run typecheck
   npm test
   npm run build
   ```

5. In the PR, explain the purpose, impact, and verification. Include screenshots or reproduction notes for UI changes.

## Code and data conventions

- Do not commit real passwords, tokens, device certificates, personal data, or production logs.
- Add tests for new interactions or replay behavior when practical.
- Keep the local-first architecture: do not upload device data, page structure, or user input by default.
- Verify the license of third-party code, images, fonts, and models, and note the source in the PR.

## License

Unless explicitly stated otherwise, your contributions are licensed under the [Apache License 2.0](LICENSE) and are subject to [CLA.md](CLA.md).
