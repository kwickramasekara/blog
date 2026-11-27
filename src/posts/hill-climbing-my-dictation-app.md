---
title: Hill climbing my dictation app
date: 2026-11-15T14:12:00.000-06:00
tags: technology
shareCardImage: https://4fk4v31mik.ucarecd.net/d4946e6c-d3c5-4cbc-b21d-21c347992708/-/format/auto/-/quality/normal/-/stretch/off/-/resize/640x/
---
![](https://4fk4v31mik.ucarecd.net/d4946e6c-d3c5-4cbc-b21d-21c347992708/-/format/auto/-/quality/normal/-/stretch/off/-/resize/1280x/)

## Why I built a dictation app

I tried a lot of dictation apps. The ones that run on your computer were not accurate enough. The ones that run in the cloud send
your voice to someone else's servers. And none of them spelled the tech words I use every day, or cut the "um"s and
"uh"s.

Then FluidVoice released [Fluid Speech Pro](https://huggingface.co/FluidVoice-Labs/fluid-speech-pro-mlx), a free
speech-to-text model that removes filler words in one pass. On a recent Mac it turns 4 seconds of speech into text in about
60 milliseconds, without the internet. So I had Claude Code build me a small app around it called Tidy Parrot. Tap a
key, talk, tap it again, and the text appears wherever you're typing. Nothing leaves the Mac.

Fluid Speech is fast and accurate too, so that solved my trifecta of speed, accuracy and cleanup. Tech words were
still wrong though. It typed "post hoc" for PostHog, "PostGur SQL" for PostgreSQL and "Cubeactal" for kubectl.

## Nudging the model instead of retraining it

My first idea was to retrain the model on my words (LoRA adapter plugged into the model). That means recording audio for every word and retraining every time
the list changes.

Claude found a shortcut. The model can take a word list. While it guesses each word, it gives a small bonus to guesses
that match something on the list. No retraining.

The catch was a handful of dials, like how big the bonus is, with no advice on where to set them. Too low and nothing
changes. Too high and the app starts "hearing" your words in normal speech. Finding the right settings is a search
problem, so we used hill climbing.

## What hill climbing is

Picture finding the top of a hill in thick fog. You can't see the peak, so you take a step, check if you went up, and
keep the step only if you did. Repeat until every direction leads down.

With software, the hill is a score and each step is a small change to one setting. People use it everywhere. Andrej
Karpathy's [autoresearch](https://github.com/karpathy/autoresearch) has an AI agent tweak a model's training code, run a
5-minute test, and keep the tweak only if the result improved. Tools like
[OpenTuner](https://commit.csail.mit.edu/papers/2014/ansel-pact14-opentuner.pdf) use it to find the settings that make
programs run fastest.

## The prompt

Here's roughly what I asked Claude:

> Build a dictionary of the front-end words I use, like PostHog, Datadog and ast-grep, plus test sentences full of
> them. Measure how the app does today as a baseline. Then hill climb the settings. Change one at a time, keep a change
> only if the score improves, and stop when nothing helps. I want the highest accuracy at the lowest delay, so show me
> the Pareto frontier.

The Pareto frontier is the set of best trade-offs. Every point on it is the most accurate option at its speed. To go
further along it, you have to give something up.

## What came back

Before touching a single setting, Claude built a test. 120 sentences, 30 of them traps like "we need to react quickly"
that must not turn into tool names. Half were held back as a final exam the climb never saw. Today's app got 43% of the
tech words right.

Then it climbed, four times over, each run caring a different amount about speed. 87 settings tested, each on 180
recordings.

The table below uses four terms:

- **Spelling fix** - After the model finishes, it joins split words and fixes capitals, so "next JS" becomes Next.js.
- **Word list** - The bonus from earlier. Guesses that match a word on your list score a little higher.
- **Fast mode** - The model commits to its single best guess at each step.
- **Slow mode** - The model weighs several guesses before choosing. More accurate, but about twice as slow.

## The frontier

Scored on the final exam:

|                                     | Words right | False alarms | Time per sentence |
| ----------------------------------- | ----------- | ------------ | ----------------- |
| Before                              | 43%         | 3            | 44 ms             |
| Spelling fix                        | 66%         | 0            | 41 ms             |
| Spelling fix + word list, fast mode | 76%         | 0            | 42 ms             |
| Spelling fix + word list, slow mode | 83%         | 5            | 79 ms             |

Past the third row, every extra point costs time or false alarms. I shipped that row. 33 more words in 100 spelled
right, no false alarms, no extra wait.

## Agents make this cheap

This would have taken me days by hand. Here it took one prompt. Claude built the test, ran the climbs in the background
and handed back a table.

Anything with dials and a score you can measure works the same way, like image compression on a website, build speed or
the prompt behind an AI feature. When two goals pull against each other, ask an agent for the frontier and pick your
trade-off.
