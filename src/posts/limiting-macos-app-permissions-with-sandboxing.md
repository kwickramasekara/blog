---
title: Limiting macOS app permissions with sandboxing
date: 2025-07-21T19:12:00.000-05:00
tags: technology
---
Recently, I came across [ProNotes](https://pronotes.app), a slick extension to Apple Notes that adds slash commands and some Markdown-inspired features. It seemed perfect for my workflow as a dev, but I’m cautious about privacy. My notes often hold sensitive material, so I absolutely didn’t want a third-party app to be able to “phone home.”

I looked for ways to block internet access for ProNotes. In macOS System Settings, you can easily block **incoming** connections for an app, but frustratingly, there’s no built-in UI toggle to restrict **outgoing** ones. Some web research led me to apps like Little Snitch and Radio Silence, but I didn't want to install another app and prefer to stick with native solutions wherever possible.

## Blocking network access 

This is where I discovered macOS’s hidden gem: **app sandboxing**. The `sandbox-exec` command lets you precisely control what resources an app can access, including network access.

All I needed was a sandbox profile. Here’s what I came up with to block both incoming and outgoing network connections for ProNotes:

```bash
sandbox-exec -p '(version 1)(allow default)(allow mach*)(deny network-outbound)(deny network-inbound)(deny network-bind)' /<APP LOCATION>/ProNotes
```

- `(deny network-outbound)` - blocks outgoing network connections.
- `(deny network-inbound)` - blocks incoming connections.
- `(deny network-bind)` - further ensures the app can’t open network sockets.
- The rest gives ProNotes access to what it needs to run locally.

This ensures that ProNotes has zero ability to connect to the internet after you launch it with this command. No data leaves your system - perfect for privacy.

## Launching the sandboxed app at login

The other part to this is that I wanted ProNotes to auto-launch when I log in. Since `sandbox-exec` runs in Terminal, just dragging ProNotes into Login Items wouldn’t work. Time for a little Automator magic.

**Here’s my solution:**

1. Open Automator
2. Create a New Document - choose “Application” as the document type.
3. Add a "Run Shell Script" action
4. Paste the script below.
```bash
sandbox-exec -p '(version 1)(allow default)(allow mach*)(deny network-outbound)(deny network-inbound)(deny network-bind)' /<APP LOCATION>/ProNotes &> /dev/null & exit 0
```
   - Update `APP LOCATION`
   - The trailing `&> /dev/null & exit 0` ensures Automator’s wrapper finishes cleanly while your app stays open.
5. Save the Automator application somewhere you like.
6. Go to System Settings > Users & Groups > Login Items, and add the saved Automator app.

That’s it! Now, every time you log in, ProNotes starts with all network connections blocked.

This approach gave me granular privacy control over a tool I genuinely like. If you want even more control, you have the option to create a separate `.sb` file with additional restrictions or permissions tailored to your needs.
