---
title: Teaching a Tiny ML Model Your Domain Language
date: 2026-03-21T14:32:00.000-05:00
tags: technology
---
You've got a search input. Behind it, tens of thousands of structured options like diagnostic codes, product SKUs, procedure names, whatever your domain calls them. Users type messy, abbreviated, natural language queries and expect the right result to show up instantly.

Keyword matching gets you halfway there. But when someone types "won't start in the cold" and the correct option is labeled `Low temperature cranking performance test`, keyword search comes up empty. You need something that understands meaning.

This post walks through how I fine-tuned a small embedding model to run entirely in the browser for semantic search over 80,000+ structured titles in an automotive application. The approach generalizes to any domain where you need to match freeform text input against a fixed set of structured options.

## Why an Embedding Model and Not an LLM?

When people hear "AI-powered search," the first thought is usually a large language model like ChatGPT or Claude. But LLMs are the wrong tool here.

LLMs are _generative_. They read a prompt and produce text. To use one for search, you'd need to send your query plus the entire catalog to the model and ask it to pick the best match. With tens of thousands of options, that's a massive prompt, it's slow, it requires a network call, and it's expensive at scale.

Embedding models are different. They don't generate text. They convert text into a numeric vector (a list of numbers) that captures its meaning. Two pieces of text with similar meaning produce vectors that are close together in this numeric space. To search, you convert the query into a vector and find the closest pre-computed title vectors using basic math (cosine similarity).

This makes embedding models perfect for the "match this input against a big list" problem. They're small, fast, and once your title vectors are computed, search is just math.

![](https://4fk4v31mik.ucarecd.net/282bb15e-4864-43ff-b15a-15a7f364926d/-/format/auto/-/quality/normal/-/stretch/off/-/resize/1280x/)

## The Setup

The application has a search/filter input that lets users find options from a catalog of over 80,000 structured titles. These titles follow domain-specific conventions and shorthand that general-purpose search doesn't handle well.

The core requirements:

- **Speed**: results must appear as the user types, so no network round-trips
- **Semantic understanding**: match by meaning, not just keywords
- **Small footprint**: needs to run in a browser tab

## Choosing the Model

I landed on `BAAI/bge-small-en-v1.5` after browsing the [HuggingFace MTEB leaderboard](https://huggingface.co/spaces/mteb/leaderboard). At 33M parameters with 384-dimensional embeddings, it sits in a sweet spot: strong retrieval quality on benchmarks while being small enough to convert to ONNX with INT8 quantization and run in a browser. The quantized model comes in around ~30MB, which is manageable with a service worker downloading it in the background when the application first loads. Once downloaded, the model is cached in the browser, so subsequent visits skip the download entirely.

Larger models in the BGE family (base, large) score higher on benchmarks but are too heavy for client-side inference. The BGE family also has well-documented fine-tuning tooling through the [FlagEmbedding](https://github.com/FlagOpen/FlagEmbedding) project, which made the whole process more straightforward.

## The Training Data Problem

Here's the catch: I had zero real user search queries. The search input didn't collect any data. No logs, no analytics, nothing.

To get around this, I used a large language model (Claude) to generate synthetic training data through knowledge distillation. For each structured title and its associated category, Claude generated 8-15 realistic search queries that a domain expert might type. These ranged from keyword-style searches to natural language descriptions to abbreviated shorthand.

This is knowledge distillation in a nutshell: a large, capable model that already understands your domain language creates supervised training signal for a much smaller, specialized model. The small model learns to map diverse query phrasings to correct titles, something it couldn't do from its general pre-training alone, while staying fast enough for real-time search.

![Knowledge Distillation Concept](https://4fk4v31mik.ucarecd.net/4083a370-234e-40d3-b49f-ae1709ff6aad/-/format/auto/-/quality/normal/-/stretch/off/-/resize/1280x/)

## The Training Pipeline

The 80,000+ raw titles contain massive duplication (templated variations, shared titles across categories), so the first step is deduplication down to ~3,000 unique titles for training purposes. The model still searches against the full catalog at runtime.

The full pipeline from raw data to browser-ready model:

1. **Export titles** from the database, grouped by category
2. **Deduplicate** across categories (many titles are templated variations of each other)
3. **Generate synthetic queries** via Claude (8-15 per title)
4. **Sample random negatives** for each query (incorrect titles paired with it)
5. **Mine hard negatives** using the base model to find the most confusable incorrect titles
6. **Split** into 90/10 train/test
7. **Fine-tune** using contrastive learning (InfoNCE loss)
8. **Convert to ONNX** with INT8 quantization for browser inference
9. **Evaluate** against the held-out test set

The hard negative mining step (5) is worth highlighting. Instead of just pairing queries with random wrong answers, you use the base model itself to find titles that it currently thinks are similar to the query but are actually wrong. Training against these "almost right" examples forces the model to make finer distinctions.

## Three Iterations of Learning

### Iteration 1: Small Scale (189 titles)

Started with 7 categories and 189 unique titles. About 8 synthetic queries per title, 1,574 training examples total.

| Metric    | Base Model | Fine-tuned | Improvement |
| --------- | ---------- | ---------- | ----------- |
| Recall@5  | 31.7%      | 43.9%      | +12.2%      |
| Recall@10 | 48.8%      | 64.6%      | +15.9%      |
| MRR       | 23.3%      | 30.6%      | +7.3%       |

Promising gains, but 36 queries got _worse_ after fine-tuning. Some dropped badly: "rod knock investigation" went from rank 30 to rank 132. This is **catastrophic forgetting**, where full fine-tuning modifies all 33M weights, and with limited training data the model overwrites its general language understanding to memorize synthetic phrasing patterns.

I tested LoRA (Low-Rank Adaptation) as an alternative, which only trains ~100K parameters instead of all 33M. The theory is that LoRA preserves more pre-trained knowledge. In practice, full fine-tuning still outperformed LoRA by 3-5% across all metrics. Both methods regressed on similar queries, which pointed to training data as the real bottleneck, not the training approach.

### Iteration 2: Scale the Data (2,974 titles)

Same hyperparameters, but expanded from 7 categories to 821 and from 189 to 2,974 unique titles. This gave 37,339 training examples, a 23x increase.

| Metric    | Base Model | Fine-tuned | Improvement |
| --------- | ---------- | ---------- | ----------- |
| Recall@5  | 47.9%      | 63.5%      | +15.6%      |
| Recall@10 | 57.6%      | 74.2%      | +16.6%      |
| MRR       | 35.8%      | 47.3%      | +11.4%      |

The improvement-to-regression ratio jumped from 2.9:1 to 4.9:1. Training loss actually converged below the random baseline for the first time (1.34 vs the random guess threshold of 2.08). With enough data, the model learned to generalize instead of memorize.

The character of regressions also changed. In iteration 1, common terms like "engine running lean" regressed. In iteration 2, regressions were mostly ultra-short abbreviations like "chk fltr" and "algnmnt chk" where the base model had lucky token overlap that fine-tuning disrupted.

![Model Iterations Performance](https://4fk4v31mik.ucarecd.net/021283ca-d9f5-4e42-9849-7470151d37dc/-/format/auto/-/quality/normal/-/stretch/off/-/resize/1280x/)

### Iteration 3: Hyperparameter Tuning

Same data as iteration 2. Halved the learning rate (1e-5 to 5e-6), increased epochs (3 to 5), and doubled the group size to use all 15 hard negatives per training step.

Result: 1-1.5% lift across metrics. 31 fewer top-5 failures. Marginal improvement.

The takeaway across all three iterations was clear: **data scaling gave 10x the returns of hyperparameter tuning**. Once you have enough diverse training examples, tweaking learning rates and batch sizes barely moves the needle.

## Failure Analysis: Where It Still Breaks

Even after iteration 3, about 36% of test queries failed to rank the correct title in the top 5. But most of these are near-misses. The top-5 results are semantically valid alternatives from the same domain, and the correct title sits at rank 6-10.

For example, a query like "dropped the oil and put a new filter on" returns five oil/filter change variants in the top 5, with the exact target title at rank 6. In a search UI where users scan a filtered list, these near-misses still surface the right answer.

The failures that actually matter (correct title ranked far below the visible window) cluster around two patterns:

1. **Near-duplicate titles**: when multiple titles describe essentially the same procedure, the model has no way to prefer one over another
2. **Abbreviation gaps**: ultra-short abbreviations absent from training data ("chk fltr", "recal lgcm") where the model has no learned mapping

## What I'd Do Differently (and What Generalizes)

**The synthetic data approach works remarkably well as a cold start.** If you have zero user queries, using a large LLM to generate training data is a totally viable path. The key is generating enough volume and diversity. Our jump from \~1,500 to \~37,000 training examples is what actually made the model useful.

**Data beats architecture.** LoRA vs full fine-tuning, learning rate sweeps, batch size experiments: none of these mattered as much as simply having more and better training data. If your model isn't performing well, add more data before reaching for a different training technique.

**Running ML in the browser is more viable than you'd think.** A ~30MB quantized ONNX model downloaded via service worker and cached in the browser, with embedding vectors stored in IndexedDB, gives you real-time semantic search with zero network latency after the initial load. For applications where the search corpus is bounded (tens of thousands of options, not millions), this is a strong pattern.

**The remaining bottleneck is real user data.** Synthetic data got us to ~64% Recall@5. To go further, you need actual search logs. Instrument your search input early, even before you have the ML model in place. That data is gold.

## Applying This to Your Domain

The pattern here isn't specific to automotive. If you have:

- A fixed (or slowly changing) catalog of structured options
- Users searching with freeform natural language
- A need for low-latency results

...then you can follow the same playbook:

1. Pick a small, high-quality embedding model from the MTEB leaderboard
2. Generate synthetic training queries with a large LLM
3. Fine-tune with contrastive learning and hard negative mining
4. Quantize to ONNX for wherever you need to run inference
5. Iterate on data volume first, hyperparameters second

The structured options could be medical codes, legal citations, product catalogs, support ticket categories, or anything else where the gap between how things are labeled and how people search for them is wide enough that keyword matching falls short.
