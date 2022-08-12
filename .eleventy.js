const dayjs = require("dayjs");
const syntaxHighlight = require("@11ty/eleventy-plugin-syntaxhighlight");
const njkFilters = require("nunjucks/src/filters");

const META_DESCRIPTION_LENGTH = 160; // https://moz.com/learn/seo/meta-description

module.exports = function (eleventyConfig) {
  eleventyConfig.addWatchTarget("./src/styles/");

  eleventyConfig.addPassthroughCopy("admin");

  eleventyConfig.addPlugin(syntaxHighlight, {
    templateFormats: ["md"],
  });

  eleventyConfig.addNunjucksFilter("formatDate", function (dateString) {
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

      // get the first paragraph element
      paragraphContent =
        paragraphContent.length > 2 ? paragraphContent[1].split("</p>") : null;

      // convert array to string
      paragraphContent = paragraphContent
        ? njkFilters.string(paragraphContent)
        : null;

      // convert any anchor elements to text
      paragraphContent = paragraphContent
        ? njkFilters.striptags(paragraphContent)
        : null;

      // limit description length to SEO standards
      paragraphContent = paragraphContent
        ? njkFilters.truncate(paragraphContent, META_DESCRIPTION_LENGTH)
        : null;

      return paragraphContent;
    }

    return null;
  });

  return {
    dir: {
      input: "src",
      output: "dist",
    },
  };
};
