# Blog

A minimal blog made with [eleventy](https://www.11ty.dev/) - content managed with [Decap CMS](https://decapcms.org/) and hosted at [Netlify](https://www.netlify.com/).

## Local Development

- `dev` - Starts serving the site locally at 8080.
- `dev:cms` - Starts a Decap CMS server locally.
  1. Run both `dev` and `dev:cms` in parallel.
  2. Point the browser to `http://localhost:8080/admin`.

**Note:**
Git hooks are enabled with [Husky](https://typicode.github.io/husky) to run Prettier formatting on commits.

Cloudinary credentials used by the one-off migration script live in `.env` (or `.env.local`). Both files are git ignored; see `.env.example` for the expected variables. Never commit the Cloudinary API secret.

## Folder Structure

- `.husky` - Git hooks.
- `admin` - Decap CMS for authoring blog posts.
- `dist` - Git ignored; build dumps all static files here.
- `migration-map.json` - Audit trail for the Uploadcare-to-Cloudinary image migration.
- `scripts` - One-off maintenance scripts.
- `src` - All source files read by eleventy.
  - `posts` directory can be extracted out for site migrations.
    - `posts.11tydata.json` is only added to set global settings for blog posts.

## Blog posts

With the idea of keeping the markdown syntax of blog posts highly compatible and to make it easy to do lift-and-shifts of content, some authoring choices have been made for certain scenarios.

### Images

Include captions for all images as a general rule of thumb. Some images maybe used as props and those can be left alone.

**Markdown:**
`![image-alt](image-url)_image-caption_`

**Compiled HTML:**
`<img src="img-url" alt="img-alt"><em>image-caption</em>`

**Style:**
This is styled to look like the emphasis text appears right below the image with a smaller font size and muted color.

**Note:** Image elements get enhanced with lazy loading, `width`/`height`, and an inline blurred placeholder during markdown-to-HTML compilation. See `.eleventy.js` and `images.js` for more details.

#### Image hosting

Images are hosted on [Cloudinary](https://cloudinary.com/) and managed through Decap CMS's built-in Cloudinary media library. Uploading or selecting an image from `/admin` opens Cloudinary's media library and requires a Cloudinary login; third-party cookie blocking can prevent the widget from working, so allow cookies for `cloudinary.com` if needed.

- The cloud name and API key are public and live in `admin/config.yml`. The API secret must stay in `.env`/`.env.local` and must never be committed or exposed in the browser.
- `CLOUDINARY_UPLOAD_PRESET` is only needed for direct unsigned uploads. Decap's Cloudinary media library authenticates with the Cloudinary login instead of an upload preset.
- Content stores canonical, transformation-free Cloudinary URLs. The build applies the display transformation (`c_limit,w_1280,h_1280/f_auto/q_auto`), the share-card transformation (`c_limit,w_640,h_640/f_auto/q_auto`), and the author image transformation (`c_limit,w_240,h_240/f_auto/q_auto`). Crops or other transforms applied inside the Cloudinary media library are therefore not preserved in the stored URL; use the media library for asset selection, not for per-post transforms.
- Metadata and 24 px blurred JPEG LQIPs are fetched at build time with `fl_getinfo` and Cloudinary transformations, then cached indefinitely by `@11ty/eleventy-fetch` in `node_modules/.cache/images`.
- The Cloudinary Free plan allows 10 MB or 25 MP per image and 25 monthly credits. Images that exceed those limits must be downscaled before upload.

#### Migrating legacy Uploadcare images

The existing Uploadcare images were migrated with `npm run migrate:images`. The script audits every Uploadcare URL referenced in `src/`, resizes originals that exceed Cloudinary's size/MP limits at JPEG quality 90, uploads them to `blog/<uploadcare-uuid>`, writes `migration-map.json`, rewrites `src/`, and verifies the Cloudinary assets. It is idempotent, skips assets already recorded in the map, and never deletes anything from Uploadcare. Use `npm run migrate:images -- --dry-run` to audit without uploading or rewriting.

Four originals needed downscaling. Where those images have a “High Resolution” link, it points to the downscaled version. Uploadcare support remains in `images.js` as a fallback until the migration is fully verified; it can be removed after that.

#### Image attributions

Proper attribution for image sources are required. Add a link to source within image caption that reads as follows:
`Image caption (Source)`

**Example:**
[What they don't teach you in school](https://blog.keithw.me/what-they-dont-teach-you-in-school/#credit-score)

#### High resolution image

Sometimes you want to link to a high resolution image. Follow the same pattern/format for adding links:
`Image caption (High Resolution)`

A few migrated images were larger than Cloudinary's 10 MB/25 MP Free-plan limits, so their high-resolution link points to the downscaled source.

**Example:**
[Always shoot RAW](https://blog.keithw.me/always-shoot-raw/)

### YouTube videos

**Markdown:**
`![image-alt](youtube-thumbnail-url)_image-caption ([YouTube](youtube-url))_`

**Compiled HTML:**
`<img src="img-url" alt="img-alt"><em>image-caption (<a href="youtube-url">YouTube</a>)</em>`

**Style:**
Same as image captions above, this will use video thumbnail as the image and image caption will contain the link to the video.

**Note:**
To get the high-res thumbnail of a YouTube video, visit `http://img.youtube.com/vi/<video-id>/maxresdefault.jpg`. Remember to replace `video-id` with the id of the video.

**Example:**
[How to get free grocery delivery](https://blog.keithw.me/how-to-get-free-grocery-delivery/)
