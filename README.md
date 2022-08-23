# Blog

A minimal blog made with [eleventy](https://www.11ty.dev/) - content managed with [Netlify CMS](https://www.netlifycms.org) and hosted at [Netlify](https://www.netlify.com/).

## Local Development

- `dev` - Starts serving the site locally at 8080.
- `dev:cms` - Starts a Netlify CMS server locally.
  1. Run both `dev` and `dev:cms` in parallel.
  2. Point the browser to `http://localhost:8080/admin`.

**Note:**
Git hooks are enabled with [Husky](https://typicode.github.io/husky) to run Prettier formatting on commits.

## Folder Structure

- `.husky` - Git hooks.
- `admin` - Netlify CMS for authoring blog posts.
- `dist` - Git ignored; build dumps all static files here.
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

#### Image attributions

Proper attribution for image sources are required. Add a link to source within image caption that reads as follows:
`Image caption (Source)`

**Example:**
[What they don't teach you in school](https://blog.keithw.me/what-they-dont-teach-you-in-school/#credit-score)

#### Full resolution image

Sometimes you want to link to a full resolution image. Follow the same pattern/format for adding links:
`Image caption (Full Resolution)`

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
