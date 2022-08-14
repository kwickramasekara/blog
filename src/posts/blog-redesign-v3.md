---
title: Blog redesign
date: 2022-08-14T16:33:08.048Z
tags: technology
---
This blog has gone through a couple of redesigns and re-architectures in the past. First iteration was a self-hosted [Ghost](https://ghost.org) instance with a default theme and second was a static site made with [Hugo](https://gohugo.io) hosted on [Netlify](http://netlify.com). This time around, I was more inspired by the idea of [this great website](http://motherfuckingwebsite.com/) and followed a clean, minimal aesthetic similar to my [landing page](https://keithw.me). Below is a little before and after for comparison.

**Before:**
![](https://ucarecdn.com/22ab397d-bcef-49c8-8d05-c99b91cf46f3/-/format/auto/-/quality/smart_retina/-/stretch/off/-/resize/1200x/)

**After:**
![](https://ucarecdn.com/a244dded-881e-4058-b539-ea00fbd4f0b5/-/format/auto/-/quality/smart_retina/-/stretch/off/-/resize/1200x/)

Since I noticed my pattern of reworking the blog every few years, I wanted to make the content to be somewhat flexible and easy to extract. So I decided to use markdown and use standard syntax without any framework specific shortcodes. Thought of using headless CMS such as contenful crossed my mind but Netlify CMS is still a great open-source solution to manage a git based workflow. Plus, it has the editorial workflow that seamlessly integrates with Netlify to generate draft previews so that was an easy decision.


- Editorial workflow with Netlify CMS
- Code formatting
- Uploadcare images
- No js 
- Site size
- Dark mode w css variables
- Auto description 
- Auto tag pages
- Reading time

Source code is available on Github.
