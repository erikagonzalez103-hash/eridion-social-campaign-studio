# Image conversation — prepared, not deployed

The existing single-file Studio now has **Create / Revise image** in each Library post's Edit menu and image picker. It opens a conversation tied to that post. Discuss mode makes no image; Create and Revise each request one image. Revisions include the selected base image, prior conversation, full source-blog copy and URL, the correct brand brief/knowledge base, and up to five selected brand references.

Versions and conversation are stored on the Library item and included in Library JSON exports. Selecting a version changes the next edit's base, not the attached post image. **Use for this post** replaces a chosen carousel slot or appends a slide; **Undo image selection** restores prior attachments. Neither action sends to Buffer. Reusable direction is explicitly saved either on the source-blog campaign (keyed by visual brand) or in browser-local brand guidance. Brand-wide guidance follows the existing Brand Refs storage model and is not included in the Library export.

## Reconciled backend

The parent `../worker.js` is older than production. The live `frosty-base-f01e` source was retrieved read-only on September 27, 2026. Production already has `/api/upload`, `/api/catalog`, `/api/wix`, the `CATALOG` R2 binding, `ERIDION_KV`, and the `OPENAI_API_KEY` secret. **Do not deploy the parent worker file.** It was not changed.

`backend/image-chat.js` adds `/api/image-chat` through `scripts/prepare-image-worker.cjs`. The prepared candidate is `.image-work/worker-candidate.mjs`; the baseline hash is `.image-work/source-sha256.txt`. The patch preserves all existing deployed source and routes, adding one routing line and the new handler. Downloaded source, settings, Library backup and test requests are ignored by Git.

The handler uses OpenAI Responses with `gpt-5.5` for conversation and `gpt-image-2` for images. Server-side `STUDIO_CHAT_MODEL` and `STUDIO_IMAGE_MODEL` can override these, but any substitute must support the same tool and size contract. No OpenAI key enters the browser. Reference URLs are limited to the existing R2 public host, ImgBB and Unsplash; other references need to be uploaded first. Outputs go directly into `CATALOG/studio-images/<brand>/`, and only URLs/metadata are returned. KV caches request results for 24 hours to recover an interrupted browser request without automatically purchasing a second generation. This is recovery caching, not a transactional global idempotency lock.

The implementation follows the official [image generation tool documentation](https://developers.openai.com/api/docs/guides/tools-image-generation) and [image sizing guidance](https://developers.openai.com/api/docs/guides/image-generation). Default output is 1024 × 1280 (4:5); square, landscape and 2:3 are available. One carousel slide is generated per turn. Prompt rules request concise copy, source-payoff continuity, separate branding, authentic Quinta imagery, layout reflow, safe margins and logo preservation; actual visual quality still needs the live generation check.

## Verified

- `node tests/image-chat.test.cjs`: 10 passing checks, covering request construction, edit targets, reference inputs, discussion without image tools, input/URL validation, R2 output, request recovery, provider failure, brand isolation, carousel selection/undo, quota failure, concurrent-tab protection and conversation/version persistence.
- Inline JavaScript and prepared worker parse successfully. `git diff --check` passes.
- Browser preview with an isolated copy of the real Library: discuss → create → revise → compare → select → undo → reload/reopen. Conversation and both versions survived reload; the post retained its original schedule and caption.
- The actual captured revision request includes Quinta's 9,348-character source blog, `https://quintaand.co/go/someday`, four preceding conversation turns, the selected image URL and 1024 × 1280 dimensions.
- After saving a Quinta-only correction in the preview, an Eridion post request was checked separately: it contains Eridion's architectural brief and original mirror-wall blog, with no Quinta correction or sage palette in its brand context.
- Real source found: “What stops us from taking the time to invest in ourselves to better our business? (need a better title)”, Library ID `lib_1790112125080_ho245`, saved September 22. Its children include September 30–October 2 posts. The production Library was only exported, not edited.

## Remaining live verification and release

No OpenAI generation, production deployment, Git push or social publishing was performed. The existing OpenAI secret is only available inside production; there is no local OpenAI key. Browser tests use a clearly labeled simulated API and reuse the existing source hero solely to exercise image controls. They do not establish generated-image quality or current account/model access.

1. Review the local preview at `http://127.0.0.1:5587/` (start with `node scripts/preview-image-chat.cjs` if needed). It requires the ignored Library backup; it never calls OpenAI.
2. Obtain deployment approval required by `../AGENTS.md`: “Deploying is a production change. Say what's changing and get an explicit yes first.” Approval must cover the shared worker addition and Studio frontend release.
3. Before release, re-fetch production with `node scripts/read-image-worker.cjs`, compare to the saved baseline, reconcile any intervening changes, rebuild the candidate and rerun tests. Preserve all current worker settings, bindings and secrets when uploading through the Cloudflare API. Keep the baseline for rollback. Do not overwrite or deploy `../worker.js`.
4. Deploy the worker addition first. Confirm GET `/api/image-chat` reports revision `2026-09-27.1` and readiness. Release the reviewed `index.html` through the repository's existing GitHub Pages workflow.
5. In the production browser, open a child of the Quinta source above. Discuss the format, generate one image, revise a particular detail and visually check copy/branding/margins. Select an older version and revise from it. Only attach a final image after review. Then perform an Eridion image check with Eridion references. Do not send anything to Buffer unless separately instructed.

Access notes: the initial PowerShell Cloudflare request failed TLS and an initial `/content` read returned 405; Node HTTPS plus GET of the worker script resolved both. The subprocess-based Node test runner was blocked by the sandbox; directly running the same `node:test` file succeeded. No unresolved source-access failure remains.
