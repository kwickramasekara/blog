---
title: Blog redesign
date: 2022-08-14T16:33:08.048Z
tags: technology
shareCardImage: https://ucarecdn.com/a244dded-881e-4058-b539-ea00fbd4f0b5/-/format/auto/-/quality/normal/-/stretch/off/-/resize/640x/
---

This blog has gone through a couple of redesigns and re-architectures in the past. First iteration was a self-hosted [Ghost](https://ghost.org) instance with a default theme, and second was a static site made with [Hugo](https://gohugo.io) hosted on [Netlify](http://netlify.com). This time around, I was more inspired by the idea of [this great website](http://motherfuckingwebsite.com/) and followed a clean, minimal aesthetic similar to my [landing page](https://keithw.me). Below is a little before and after for comparison.

![Old version of the blog](https://ucarecdn.com/22ab397d-bcef-49c8-8d05-c99b91cf46f3/-/format/auto/-/quality/normal/-/stretch/off/-/resize/1280x/)_Before - old version of the blog_

![Redesigned version of the blog](https://ucarecdn.com/a244dded-881e-4058-b539-ea00fbd4f0b5/-/format/auto/-/quality/normal/-/stretch/off/-/resize/1280x/)_After - redesigned version of the blog_

Since I noticed my pattern of reworking the blog every few years, I wanted to make the content to be somewhat flexible and easy to extract. So I decided to use markdown and use standard syntax without any framework specific shortcodes. The thought of using a headless CMS such as Contenful crossed my mind, but Decap CMS (formerly Netlify CMS) is still a great open-source solution to manage a git based workflow. Plus, it has the editorial workflow that seamlessly integrates with Netlify to generate draft previews so that was an easy decision.

![Decap CMS editor](https://ucarecdn.com/a12b7ca9-be3b-4ef9-a645-4989662ee3a8/-/format/auto/-/quality/normal/-/stretch/off/-/resize/1280x/)_Decap CMS editor_

Some of the other features of the site:

- **Uploadcare integration** - Decap CMS has a great integration with [Uploadcare](https://uploadcare.com) which is a CDN made for assets. It can do a lot of image optimizations on-the-fly so all of the heavy lifting with regards to image assets are offloaded to that service. I just use their image uploader inside the CMS editor, and it spits out a URL that points to an optimized image. You can inspect any image on this page to get an idea.
- **Dark mode support** - this was pretty easy to do with CSS variables. Change theme in your system settings to see the color change.
- **No Javascript** - apart from 3rd party scripts for like CMS auth, this site does not have any Javascript.
- **Small size** - every single page is light as a feather. Less than 100kb in size without the additional Netlify auth scripts.
- **Auto descriptions** - created a small [filter that generates excerpts](/generate-excerpts-automatically-in-11ty/) out of post content to be used in meta tags for each post page.
- **Automated tag pages** - a cool, [built-in feature](https://www.11ty.dev/docs/quicktips/tag-pages/) of eleventy.
- **Reading time** - this [small snippet](https://github.com/kwickramasekara/blog/blob/main/.eleventy.js#L27) scans the contents of the page and spits out a number in minutes based on a given WPM(words per minute).
- **Syntax highlighting** - to make code snippets look pretty.

This was a pretty fun and interesting project for me and if you are interested in digging deeper into the source code, please see the [Github repo](https://github.com/kwickramasekara/blog).
