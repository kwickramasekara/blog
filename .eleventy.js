const dayjs = require("dayjs");
const markdownIt = require("markdown-it");
const markdownItAnchor = require("markdown-it-anchor");
const syntaxHighlight = require("@11ty/eleventy-plugin-syntaxhighlight");
const njkFilters = require("nunjucks/src/filters");
const { parseHTML } = require("linkedom");
const { getImageMetadata, modifyImageURL } = require("./images");

const META_DESCRIPTION_LENGTH = 160; // https://moz.com/learn/seo/meta-description

module.exports = function (eleventyConfig) {
  // set IDs to headings
  eleventyConfig.setLibrary(
    "md",
    markdownIt({ html: true }).use(markdownItAnchor)
  );

  eleventyConfig.addWatchTarget("./src/styles/");

  eleventyConfig.addPassthroughCopy("admin");

  eleventyConfig.addPlugin(syntaxHighlight, {
    templateFormats: ["md"],
  });

  eleventyConfig.addNunjucksFilter("postDate", function (dateString) {
    return dayjs(dateString).format("MMM D, YYYY");
  });

  // https://w3collective.com/calculate-reading-time-javascript/
  eleventyConfig.addNunjucksFilter("readingTime", function (content) {
    const wpm = 225;
    const words = content.trim().split(/\s+/).length;

    return Math.ceil(words / wpm);
  });

  eleventyConfig.addNunjucksFilter("metaDescription", function (content) {
    if (content) {
      let paragraphContent = content.split("<p>");

      // get the first paragraph element that is not empty or an HTML tag
      paragraphContent = paragraphContent.find(
        (item) => item.trim() !== "" && item[0] !== "<"
      );

      // convert array to string
      paragraphContent = paragraphContent
        ? njkFilters.string(paragraphContent)
        : null;

      // convert any anchor elements to text
      paragraphContent = paragraphContent
        ? njkFilters.striptags(paragraphContent)
        : null;

      // limit description length per SEO guidelines
      paragraphContent = paragraphContent
        ? njkFilters.truncate(paragraphContent, META_DESCRIPTION_LENGTH)
        : null;

      return paragraphContent;
    }

    return null;
  });

  eleventyConfig.addTransform("transformImages", async (content, outPath) => {
    if (outPath && outPath.endsWith(".html")) {
      let { document } = parseHTML(content);
      const images = [...document.querySelectorAll(".post-content img")];

      // Create an array of promises for each image processing task
      const imagePromises = images.map(async (img) => {
        const src = img.getAttribute("src") || "";
        const metadata = await getImageMetadata(src);

        if (metadata && metadata.lqip && metadata.width && metadata.height) {
          img.setAttribute("loading", "lazy");
          img.setAttribute("decoding", "async");
          img.setAttribute("class", "with-placeholder");
          img.setAttribute("width", metadata.width);
          img.setAttribute("height", metadata.height);
          img.setAttribute(
            "src",
            modifyImageURL(src, metadata.width, metadata.height)
          );
          img.setAttribute(
            "style",
            `aspect-ratio: ${
              metadata.width / metadata.height
            };background-image: url('data:image/${metadata.original.format.toLowerCase()};base64,${
              metadata.lqip
            }');`
          );
        }
      });

      // Wait for all image processing tasks to complete
      await Promise.all(imagePromises);

      // Return the modified HTML content
      return `${document.documentElement.outerHTML}`;
    }

    // Return the original HTML content if the file is not a blog post
    return content;
  });

  return {
    dir: {
      input: "src",
      output: "dist",
    },
  };
};
