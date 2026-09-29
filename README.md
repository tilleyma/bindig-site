# BINDIG landing page

Static waitlist page. Deployed on Netlify; sign-ups are collected by Netlify Forms (form name: `waitlist`).

## Sandbox (test before release)
- Every change for v0.3+ is built on a branch and opened as a pull request.
- Netlify builds a **Deploy Preview** for each pull request at `https://deploy-preview-<N>--bindig.netlify.app`.
- Previews show an amber **Sandbox** ribbon, use **Stripe test mode** (card 4242 4242 4242 4242) and keep their own stats, feedback and beta data, separate from production.
- Martin tests the preview and says "release"; the pull request is merged and Netlify deploys to production.
