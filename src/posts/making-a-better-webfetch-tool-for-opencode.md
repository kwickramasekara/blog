---
title: Making a better webfetch tool for OpenCode
date: 2026-07-20T11:44:00.000-05:00
tags: technology
---
If you've used opencode's built-in `webfetch` for any real research, you've probably hit the wall already. You ask the agent to go read some docs or pull context from a page, and it comes back with garbage. An empty body, a Cloudflare challenge page, or a shell of HTML with none of the actual content in it. The agent then either hallucinates around the gap or gives up.

The tool isn't broken. It just does the naive thing: fire an HTTP GET, take whatever comes back, convert it to markdown. That works fine for a static blog. It falls apart on a huge chunk of the modern web.

## Two things kill it

**Bot protection.** Tons of sites sit behind Cloudflare, PerimeterX, DataDome, and etc. A plain GET from a Node process looks exactly like a bot to them, because it is one. You get a challenge page or a 403, not the content. The built-in has no answer for this. It sees a 200 with a "please verify you're human" body and happily hands that back to your agent as if it were the real page.

**JavaScript-rendered sites.** This one bites even harder because it's silent. Fetch a Next.js, React, or Vue app and the raw HTML is basically an empty `<div id="root">` plus a pile of script tags. The content only exists after the JS runs in a browser. The built-in doesn't run JS, so it grabs the empty shell, converts nothing to markdown, and returns nothing useful. No error. The agent just thinks the page was blank. A shocking amount of documentation lives on JS-rendered sites now, so this is not an edge case.

## Firecrawl handles both

Firecrawl runs an actual headless browser on their end. That single fact fixes both problems at once. It renders the JS before scraping, so you get the real content off SPA sites. And it deals with the bot-protection layer for you, so pages that 403 a raw fetch come back with their actual body.

The part that makes it a no-brainer for a desktop tool: Firecrawl has a [keyless tier](https://www.firecrawl.dev/blog/firecrawl-keyless-launch) now. You POST to their scrape endpoint with no API key, no signup, no config. A thousand free scrapes a month, automatic. For an agent that fetches a handful of pages per session, that's plenty, and there's nothing for the user to set up.

## The build

opencode discovers tools by filename. Drop a file named `webfetch` into the config dir and it overrides the built-in with the same name. So the whole swap is: ship one file that calls Firecrawl instead of a raw GET, keep the same tool interface the model already knows, and the agent doesn't even notice the difference except that pages start actually working.

Here's the whole thing:

```js
// Custom opencode `webfetch` tool. Overrides the builtin (same tool name) so URL
// fetching survives bot protection: it goes through Firecrawl's keyless API, falling
// back to a direct fetch only when Firecrawl itself is unavailable.
import { tool } from "@opencode-ai/plugin"

const ENDPOINT = "https://api.firecrawl.dev/v2/scrape"
const MAX_BYTES = 5 * 1024 * 1024 // mirrors opencode's native webfetch 5MB cap
const DEFAULT_TIMEOUT_S = 30
const MAX_TIMEOUT_S = 120 // mirrors opencode's native webfetch timeout ceiling
const FORMATS = ["markdown", "text", "html", "links"]
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36"
const IMAGE_EXT = /\.(?:png|jpe?g|gif|webp|avif|bmp|ico|svg|tiff?)(?:[?#]|$)/i

const mimeOf = (res) => (res.headers.get("content-type") || "").split(";")[0].trim().toLowerCase()

// Content types safe to decode as text in the degraded fallback. Anything else (pdf,
// zip, audio, octet-stream) would dump megabytes of binary garbage into the transcript.
const isTextual = (mime) =>
  mime.startsWith("text/") ||
  mime === "application/json" ||
  mime === "application/xml" ||
  mime === "application/xhtml+xml" ||
  mime === "application/javascript" ||
  mime.endsWith("+json") ||
  mime.endsWith("+xml")

// Release a response body we are not going to read, so the socket isn't left hanging.
const discardBody = (res) => {
  const body = res.body
  if (body) body.cancel().catch(() => {})
}

// Byte-accurate bounded read: reject on Content-Length, then count streamed bytes and
// abort past the cap. Avoids buffering an unbounded body into memory. Returns raw bytes
// so binary responses (images) survive without a text round-trip.
async function readBoundedBytes(res) {
  const declared = Number(res.headers.get("content-length") || 0)
  if (declared > MAX_BYTES) {
    discardBody(res)
    throw new Error("Response too large (exceeds 5MB)")
  }
  const reader = res.body?.getReader?.()
  if (!reader) {
    const buf = new Uint8Array(await res.arrayBuffer())
    if (buf.byteLength > MAX_BYTES) throw new Error("Response too large (exceeds 5MB)")
    return buf
  }
  const chunks = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > MAX_BYTES) {
      await reader.cancel().catch(() => {}) // best-effort: don't mask the "too large" error
      throw new Error("Response too large (exceeds 5MB)")
    }
    chunks.push(value)
  }
  const buf = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    buf.set(chunk, offset)
    offset += chunk.byteLength
  }
  return buf
}

const readBoundedText = async (res) => new TextDecoder().decode(await readBoundedBytes(res))

// Base64 vision attachment, built identically for a direct image URL and for an image
// that comes back through the degraded fallback.
function imageResult(url, mime, bytes, extra) {
  return {
    title: `${url} (${mime})`,
    output: "Image fetched successfully",
    metadata: { url, actualFormat: mime, via: "direct", ...extra },
    attachments: [
      { type: "file", mime, url: `data:${mime};base64,${Buffer.from(bytes).toString("base64")}` },
    ],
  }
}

// Degraded path when Firecrawl is unavailable. Labels the body with its real content
// type (images -> base64 attachment like the builtin; non-text -> a note, never dumped),
// so the model is never told markdown when it got something else. `links` has no honest
// direct equivalent, so it errors rather than pretending.
async function degradedDirect(url, requested, signal, reason) {
  if (requested === "links")
    throw new Error(`${reason}; link extraction requires Firecrawl and has no direct fallback`)
  const res = await fetch(url, {
    signal,
    headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml,*/*;q=0.8" },
  })
  if (!res.ok) {
    discardBody(res)
    throw new Error(`${reason}; direct fetch also failed (${res.status} ${res.statusText})`)
  }
  const mime = mimeOf(res)
  if (mime.startsWith("image/"))
    return imageResult(url, mime, await readBoundedBytes(res), { format: requested, note: reason })
  if (!isTextual(mime)) {
    discardBody(res)
    return {
      title: `${url} (${mime})`,
      output: `[Degraded: ${reason}. Firecrawl unavailable; ${url} returned ${mime}, which is not text and was not decoded.]`,
      metadata: { url, format: requested, actualFormat: mime, via: "direct", note: reason },
    }
  }
  const body = new TextDecoder().decode(await readBoundedBytes(res))
  return {
    title: `${url} (degraded)`,
    output: `[Degraded: ${reason}. Firecrawl unavailable; returning raw ${mime}, not ${requested}.]\n\n${body}`,
    metadata: { url, format: requested, actualFormat: mime, via: "direct", note: reason },
  }
}

// Strip inline images, which the model can't see: nav logos and, worse, huge URL-encoded
// `data:` SVG URIs that were ~78% of one SPA test payload. Keep the alt TEXT so meaning
// survives. Link URLs are deliberately KEPT -- the model needs them to follow references
// for further research. Escape-aware (alt may contain `\]`) and paren-aware so a data URI
// containing `matrix(...)` is removed whole, not truncated at its first ")".
function cleanMarkdown(md) {
  return md
    .replace(/!\[((?:\\.|[^\]])*)\]\((?:[^()]|\([^()]*\))*\)/g, (_, alt) => alt || "")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

// Plain-text conversion for format:"text": strip markdown formatting so `text` is
// genuinely plainer than `markdown` (honors the native webfetch contract) rather than a
// silent alias. Best-effort, not a full parser.
function toPlainText(md) {
  return cleanMarkdown(md)
    .replace(/```[^\n]*\n?([\s\S]*?)```/g, "$1") // unwrap fenced code
    .replace(/^#{1,6}\s+/gm, "") // headings
    .replace(/^\s{0,3}>\s?/gm, "") // blockquotes
    .replace(/^\s*(?:[-*+]|\d+\.)\s+/gm, "") // list markers
    .replace(/\[((?:\\.|[^\]])*)\]\((?:[^()]|\([^()]*\))*\)/g, (_, text) => text || "") // links -> text
    .replace(/(\*\*|__)(.*?)\1/g, "$2") // bold
    .replace(/(\*|_)(.*?)\1/g, "$2") // italic
    .replace(/`([^`]*)`/g, "$1") // inline code
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

// A URL that points straight at an image is fetched directly and returned as a base64
// vision attachment (the builtin's behavior) -- Firecrawl would scrape it as a page and
// throw the pixels away. Returns null when the bytes aren't actually an image (the
// extension lied), so the caller can fall back to Firecrawl.
async function fetchImage(url, signal) {
  const res = await fetch(url, { signal, headers: { "User-Agent": UA, Accept: "image/*,*/*;q=0.8" } })
  const mime = mimeOf(res)
  if (!res.ok || !mime.startsWith("image/")) {
    discardBody(res)
    return null
  }
  return imageResult(url, mime, await readBoundedBytes(res), { format: "image" })
}

// Only quota/rate/server faults are recoverable via the direct fallback; a 4xx is
// a request/contract error and must surface, not silently degrade.
const isServiceError = (status) => status === 402 || status === 429 || status >= 500

export default tool({
  description:
    "Fetch a URL and return its content as clean markdown (default), text, html, or a list of " +
    "links. Uses Firecrawl to bypass bot protection; falls back to a direct fetch only when " +
    "Firecrawl is unavailable.",
  args: {
    url: tool.schema.string().describe("The URL to fetch content from"),
    format: tool.schema
      .enum(FORMATS)
      .default("markdown")
      .describe(
        "markdown (default) | text (plain text) | html (cleaned) | links (URLs on the page)",
      ),
    timeout: tool.schema
      .number()
      .optional()
      .describe(`Optional timeout in seconds (default ${DEFAULT_TIMEOUT_S}, max ${MAX_TIMEOUT_S})`),
  },
  async execute(args, context) {
    let parsed
    try {
      parsed = new URL(args.url)
    } catch {
      throw new Error("Invalid URL")
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:")
      throw new Error("URL must start with http:// or https://")

    // Normalize the format ourselves; never trust the schema default. opencode's plugin
    // path does not apply zod `.default`, and models often omit `format` or send null --
    // which would serialize to `formats:[null]` and 400 Firecrawl.
    const requested = FORMATS.includes(args.format) ? args.format : "markdown"
    const fcFormat = requested === "text" ? "markdown" : requested
    const timeoutS = Math.min(Math.max(Number(args.timeout) || DEFAULT_TIMEOUT_S, 1), MAX_TIMEOUT_S)

    // Native webfetch permission gate. Keeps a `webfetch: deny` policy effective and
    // blocks sending the URL (with any query tokens) to a third party without consent.
    // Rejects when the user denies.
    await context.ask({
      permission: "webfetch",
      patterns: [args.url],
      always: ["*"],
      metadata: { url: args.url, format: requested, timeout: timeoutS },
    })

    // Fresh timeout per network attempt, created AFTER the permission prompt so a slow
    // approval doesn't spend the budget; every attempt also honors the session abort.
    const mkSignal = () => AbortSignal.any([context.abort, AbortSignal.timeout(timeoutS * 1000)])
    const rethrowAbort = (err) => {
      if (err?.name === "AbortError") throw err // user cancelled -- do not silently retry
      if (err?.name === "TimeoutError") throw new Error(`Request timed out after ${timeoutS}s`)
    }

    // Direct image URL: hand the model the pixels as a vision attachment (the builtin's
    // behavior) rather than scraping. Falls through to Firecrawl if it isn't really an image.
    if (IMAGE_EXT.test(parsed.pathname)) {
      const image = await fetchImage(args.url, mkSignal()).catch((err) => {
        rethrowAbort(err)
        return null // image probe hiccuped -- let Firecrawl try the URL as a page
      })
      if (image) return image
    }

    let res
    try {
      res = await fetch(ENDPOINT, {
        method: "POST",
        signal: mkSignal(),
        headers: { "Content-Type": "application/json" }, // keyless: no Authorization header
        body: JSON.stringify({
          url: args.url,
          formats: [fcFormat],
          onlyMainContent: true,
          maxAge: 0, // always fresh -- native webfetch has no cache; Firecrawl defaults to 2 days
          timeout: timeoutS * 1000, // bound server-side work to the client budget
        }),
      })
    } catch (err) {
      rethrowAbort(err)
      return await degradedDirect(args.url, requested, mkSignal(), `Firecrawl network error: ${err?.message ?? err}`)
    }

    if (isServiceError(res.status)) {
      discardBody(res)
      return await degradedDirect(args.url, requested, mkSignal(), `Firecrawl unavailable (${res.status})`)
    }
    if (!res.ok)
      throw new Error(
        `Firecrawl ${res.status} ${res.statusText}: ${(await readBoundedText(res).catch(() => "")).slice(0, 500)}`,
      )

    const json = JSON.parse(await readBoundedText(res))
    if (!json?.success)
      throw new Error(`Firecrawl error: ${JSON.stringify(json?.error ?? json).slice(0, 500)}`)

    const data = json.data ?? {}
    // Firecrawl can return content AND a soft warning, or an error with no content.
    const warning = data.warning || data.metadata?.error
    const raw = requested === "links" ? (data.links ?? []).join("\n") : (data[fcFormat] ?? "")
    const output =
      requested === "text" ? toPlainText(raw) : requested === "markdown" ? cleanMarkdown(raw) : raw
    if (!output && warning) throw new Error(`Firecrawl returned no content: ${warning}`)

    const title = data.metadata?.title
    return {
      title: title ? `${title} (${args.url})` : args.url,
      output: output || "(empty response)",
      metadata: {
        url: args.url,
        format: requested,
        statusCode: data.metadata?.statusCode,
        via: "firecrawl",
        ...(warning ? { warning } : {}),
      },
    }
  },
})
```

Most of that is edge-case handling: a 5MB read cap so a giant page can't blow up memory, a direct fallback if Firecrawl is down (with an honest label so the model knows it got degraded content), image URLs returned as vision attachments, and the permission gate the built-in already had. The actual "use Firecrawl" part is one POST.

## The catch nobody warns you about

Here's the thing that surprised me. Firecrawl's markdown is cleaner than a raw dump, but it's still heavy. One SPA landing page came back at around 9,000 tokens. Three fetches like that and you've eaten most of your context window on webpage boilerplate.

The culprit was images. Not real content images, but inline SVG logos encoded as giant `data:` URIs sitting right in the markdown. Nav bar logos, framework icons, that kind of thing. On one test page those URIs were roughly 78% of the entire payload. The model can't see images anyway, so all of that is dead weight.

Stripping them (keep the alt text, drop the image) cut that page from 9,451 tokens to 2,039. Same content the model actually reads, a quarter of the size. That's the `cleanMarkdown` function above.

One thing worth resisting: it's tempting to strip link URLs too, since reference-heavy pages like Wikipedia are stuffed with them and it's a massive token saving. Don't. The agent uses those links to decide what to go read next. Kill the URLs and you kill its ability to follow a trail. Images are safe to drop because they're a dead end for a text model. Links are the opposite.

## Bottom line

The built-in webfetch quietly fails on two of the most common kinds of pages you'll actually want to read. Routing it through Firecrawl's headless browser fixes both, the keyless tier means zero setup, and a bit of markdown cleanup on the way out keeps it from torching your context. Small change, and suddenly your agent can read the web it was pretending to read before.
