#!/usr/bin/env node
/**
 * Deletes Cloudinary images that belonged to deleted blog posts.
 *
 * Usage:
 *   node scripts/cleanup-post-images.js --all-deleted
 *   node scripts/cleanup-post-images.js --all-deleted --apply
 *   node scripts/cleanup-post-images.js --base <sha> --head <sha> --apply
 *
 * Dry-run is the default. A Cloudinary image is only deleted when it was
 * referenced by a deleted post and is not referenced by the live branch or an
 * open draft pull request.
 */

const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const { parseCloudinaryURL } = require("../lib/cloudinary-url");

const ROOT = path.resolve(__dirname, "..");
const POSTS_DIR = "src/posts";
const LIVE_CONTENT_DIR = "src";
const CLOUDINARY_FOLDER = "blog/";
const MAX_DELETE_BATCH = 100;
const MAX_GIT_BUFFER = 10 * 1024 * 1024;
const CLOUDINARY_URL_PATTERN =
  "https?://res[.]cloudinary[.]com/[^[:space:]\"'<>)]+";
const CLOUDINARY_URL_EXTRACTOR =
  /https?:\/\/res\.cloudinary\.com\/[^\s"'<>)]+/g;

const dryRun = !process.argv.includes("--apply");
const allDeleted = process.argv.includes("--all-deleted");
const showHelp = process.argv.includes("--help") || process.argv.includes("-h");

/**
 * Loads .env.local and .env without overwriting existing environment variables.
 * .env.local takes precedence over .env.
 */
function loadEnvFiles() {
  for (const file of [".env.local", ".env"]) {
    const filePath = path.join(ROOT, file);

    if (!fs.existsSync(filePath)) continue;

    for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
      const match = line.match(
        /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/
      );

      if (!match) continue;

      let value = match[2];

      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }

      if (process.env[match[1]] === undefined) {
        process.env[match[1]] = value;
      }
    }
  }
}

/**
 * Returns an option's value, e.g. --base abc123.
 * @param {string} name - option name
 * @returns {string|undefined} - option value
 */
function getOption(name) {
  const index = process.argv.indexOf(name);

  return index >= 0 ? process.argv[index + 1] : undefined;
}

/**
 * Returns all values for a repeatable option, e.g. --live-ref main.
 * @param {string} name - option name
 * @returns {string[]} - option values
 */
function getOptions(name) {
  const values = [];

  process.argv.forEach((argument, index) => {
    if (argument === name && process.argv[index + 1]) {
      values.push(process.argv[index + 1]);
    }
  });

  return values;
}

/**
 * Runs a git command and returns stdout.
 * @param {string[]} args - git arguments
 * @param {number[]} allowedExitCodes - non-zero exit codes to accept
 * @returns {string} - command output
 */
function git(args, allowedExitCodes = [0]) {
  try {
    return execFileSync("git", args, {
      cwd: ROOT,
      encoding: "utf8",
      maxBuffer: MAX_GIT_BUFFER,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    if (allowedExitCodes.includes(error.status)) {
      return error.stdout ? error.stdout.toString() : "";
    }

    const stderr = error.stderr ? error.stderr.toString().trim() : "";
    throw new Error(`git ${args.join(" ")} failed: ${stderr || error.message}`);
  }
}

/**
 * Returns true when the commit exists locally.
 * @param {string} ref - commit or ref
 * @returns {boolean} - whether the ref resolves
 */
function refExists(ref) {
  if (!ref) return false;

  try {
    git(["cat-file", "-e", `${ref}^{commit}`]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Extracts Cloudinary public IDs from a block of text.
 * @param {string} text - post content or source text
 * @param {string} cloudName - Cloudinary cloud name to match
 * @returns {Set<string>} - public IDs
 */
function extractPublicIds(text, cloudName) {
  const publicIds = new Set();

  for (const rawMatch of text.matchAll(CLOUDINARY_URL_EXTRACTOR)) {
    const imageURL = rawMatch[0].replace(/[\].,;:!?]+$/, "");
    const parsed = parseCloudinaryURL(imageURL);

    if (!parsed || !parsed.publicId.startsWith(CLOUDINARY_FOLDER)) continue;

    try {
      const url = new URL(imageURL);
      const urlCloudName = url.pathname.split("/").filter(Boolean)[0];

      if (urlCloudName !== cloudName) continue;
    } catch {
      continue;
    }

    publicIds.add(parsed.publicId);
  }

  return publicIds;
}

/**
 * Returns the contents of posts deleted in the requested range or history.
 * @param {object} options - deletion source options
 * @param {string} [options.base] - first commit in a push range
 * @param {string} [options.head] - last commit in a push range
 * @param {string} options.ref - branch to scan in all-deleted mode
 * @returns {{commit: string, path: string, content: string}[]} - deleted posts
 */
function getDeletedPosts({ base, head, ref }) {
  const commitRange = base ? `${base}..${head || "HEAD"}` : ref;
  const commits = git([
    "log",
    "--format=%H",
    "--diff-filter=D",
    commitRange,
    "--",
    POSTS_DIR,
  ])
    .trim()
    .split("\n")
    .filter(Boolean);

  const deletedPosts = [];

  for (const commit of commits) {
    const paths = git([
      "diff-tree",
      "--no-commit-id",
      "--name-only",
      "-r",
      "--diff-filter=D",
      commit,
      "--",
      POSTS_DIR,
    ])
      .trim()
      .split("\n")
      .filter(Boolean);

    for (const postPath of paths) {
      try {
        deletedPosts.push({
          commit,
          path: postPath,
          content: git(["show", `${commit}^:${postPath}`]),
        });
      } catch (error) {
        console.warn(`Skipping ${postPath} at ${commit}: ${error.message}`);
      }
    }
  }

  return deletedPosts;
}

/**
 * Returns the refs that count as live content: the deployed branch, the
 * current checkout, and any open draft PRs supplied by the workflow. Stale
 * branches are intentionally ignored so old copies of deleted posts don't
 * prevent cleanup forever.
 * @param {string[]} extraRefs - additional refs to include
 * @returns {string[]} - refs
 */
function getLiveRefs(extraRefs) {
  const refs = new Set(["origin/main", "HEAD"]);

  for (const ref of extraRefs) {
    if (ref) refs.add(ref);
  }

  return [...refs].filter(refExists);
}

/**
 * Scans all live refs and the working tree for Cloudinary URLs.
 * @param {string[]} refs - refs to scan
 * @param {string} cloudName - Cloudinary cloud name to match
 * @returns {Set<string>} - public IDs
 */
function getLivePublicIds(refs, cloudName) {
  const publicIds = new Set();
  const scans = [...refs.map((ref) => [ref]), []];

  for (const args of scans) {
    let output;

    try {
      output = git(
        [
          "grep",
          "-h",
          "-o",
          "-E",
          CLOUDINARY_URL_PATTERN,
          ...args,
          "--",
          LIVE_CONTENT_DIR,
        ],
        [0, 1]
      );
    } catch (error) {
      throw new Error(
        `Unable to scan ${args[0] || "working tree"}: ${error.message}`
      );
    }

    for (const publicId of extractPublicIds(output, cloudName)) {
      publicIds.add(publicId);
    }
  }

  return publicIds;
}

/**
 * Deletes Cloudinary images in batches.
 * @param {string[]} publicIds - public IDs to delete
 * @param {object} config - Cloudinary credentials
 * @returns {Promise<boolean>} - whether every asset was deleted or already gone
 */
async function deleteCloudinaryImages(publicIds, config) {
  const { cloudName, apiKey, apiSecret } = config;
  let success = true;

  for (let index = 0; index < publicIds.length; index += MAX_DELETE_BATCH) {
    const batch = publicIds.slice(index, index + MAX_DELETE_BATCH);
    const body = new URLSearchParams();

    for (const publicId of batch) {
      body.append("public_ids[]", publicId);
    }

    const response = await fetch(
      `https://api.cloudinary.com/v1_1/${cloudName}/resources/image/upload`,
      {
        method: "DELETE",
        headers: {
          Authorization: `Basic ${Buffer.from(
            `${apiKey}:${apiSecret}`
          ).toString("base64")}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body,
      }
    );
    const text = await response.text();
    let result;

    try {
      result = JSON.parse(text);
    } catch {
      result = { raw: text };
    }

    if (!response.ok) {
      console.error(
        `Cloudinary delete failed (${response.status}): ${JSON.stringify(
          result
        )}`
      );
      success = false;
      continue;
    }

    const deleted = result.deleted || {};

    for (const publicId of batch) {
      const status = deleted[publicId] || "unknown";

      if (status === "deleted") {
        console.log(`  Deleted: ${publicId}`);
      } else if (status === "not_found") {
        console.log(`  Already gone: ${publicId}`);
      } else {
        console.error(`  Not deleted: ${publicId} (${status})`);
        success = false;
      }
    }

    if (result.partial) {
      console.error("Cloudinary reported a partial deletion.");
      success = false;
    }
  }

  return success;
}

/**
 * Prints usage details.
 */
function printHelp() {
  console.log(`Usage:
  node scripts/cleanup-post-images.js --all-deleted [--apply]
  node scripts/cleanup-post-images.js --base <sha> --head <sha> [--apply]

Options:
  --all-deleted   Scan every post deletion in origin/main history.
  --base <sha>    First commit of a push range.
  --head <sha>    Last commit of a push range (defaults to HEAD).
  --ref <ref>     Branch to scan in all-deleted mode (default: origin/main).
  --live-ref <ref>
                  Additional ref that counts as live content. Repeatable.
  --apply         Delete orphaned images. The default is a dry run.

Environment:
  CLOUDINARY_CLOUD_NAME
  CLOUDINARY_API_KEY
  CLOUDINARY_API_SECRET`);
}

/**
 * Runs the cleanup.
 */
async function main() {
  loadEnvFiles();

  if (showHelp) {
    printHelp();
    return;
  }

  const base = getOption("--base");
  const head = getOption("--head") || "HEAD";
  const ref = getOption("--ref") || "origin/main";

  if (base && allDeleted) {
    throw new Error("Use either --base/--head or --all-deleted, not both.");
  }

  if (!base && !allDeleted) {
    throw new Error("Specify --all-deleted or --base/--head. See --help.");
  }

  if (base && !refExists(base)) {
    console.log(`Base commit ${base} is not available; nothing to clean up.`);
    return;
  }

  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;

  if (!cloudName) {
    throw new Error("CLOUDINARY_CLOUD_NAME is required.");
  }

  const deletedPosts = getDeletedPosts({ base, head, ref });

  if (deletedPosts.length === 0) {
    console.log("No deleted posts found.");
    return;
  }

  const deletedPublicIds = new Set();

  for (const post of deletedPosts) {
    const publicIds = extractPublicIds(post.content, cloudName);

    if (publicIds.size > 0) {
      console.log(`${post.path}: ${publicIds.size} Cloudinary image(s)`);
    }

    for (const publicId of publicIds) {
      deletedPublicIds.add(publicId);
    }
  }

  console.log(
    `\nFound ${deletedPublicIds.size} Cloudinary image(s) across ${deletedPosts.length} deleted post revision(s).`
  );

  if (deletedPublicIds.size === 0) return;

  const liveRefs = getLiveRefs([head, ref, ...getOptions("--live-ref")]);
  const livePublicIds = getLivePublicIds(liveRefs, cloudName);

  if (livePublicIds.size === 0) {
    throw new Error(
      "Refusing to delete: no live Cloudinary references were found. Check the checkout and refs."
    );
  }

  const orphanedPublicIds = [...deletedPublicIds]
    .filter((publicId) => !livePublicIds.has(publicId))
    .sort();

  console.log(
    `Found ${livePublicIds.size} live Cloudinary reference(s) across ${liveRefs.length} ref(s).`
  );

  if (orphanedPublicIds.length === 0) {
    console.log("No orphaned images to delete.");
    return;
  }

  console.log(`\n${orphanedPublicIds.length} orphaned image(s):`);

  for (const publicId of orphanedPublicIds) {
    console.log(`  - ${publicId}`);
  }

  if (dryRun) {
    console.log(
      "\nDry run complete. Re-run with --apply to delete these images."
    );
    return;
  }

  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;

  if (!apiKey || !apiSecret) {
    throw new Error(
      "CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET are required with --apply."
    );
  }

  console.log("\nDeleting from Cloudinary...");

  const success = await deleteCloudinaryImages(orphanedPublicIds, {
    cloudName,
    apiKey,
    apiSecret,
  });

  if (!success) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
