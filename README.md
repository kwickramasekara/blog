# Blog

A minimal blog made with [eleventy](https://www.11ty.dev/) - content managed with [Netlify CMS](https://www.netlifycms.org) and hosted at [Netlify](https://www.netlify.com/).

## Local Development

- `dev` - Starts serving the site locally at 8080.
- `dev:cms` - Starts a Netlify CMS server locally.
  1. Run both `dev` and `dev:cms` in parallel.
  2. Point the browser to `http://localhost:8080/admin`.

**Note:** Git hooks are enabled with [Husky](https://typicode.github.io/husky) to run Prettier formatting on commits.

## Folder Structure

- `.husky` - Git hooks.
- `admin` - Netlify CMS for authoring blog posts.
- `dist` - Git ignored; build dumps all static files here.
- `src` - All source files read by eleventy.
  - `posts` directory can be extracted out for site migrations.
    - `posts.11tydata.json` is only added to set global settings for blog posts.
