const dayjs = require("dayjs");

module.exports = function (eleventyConfig) {
  eleventyConfig.addWatchTarget("./src/styles/");

  eleventyConfig.addHandlebarsHelper("formatDate", function (dateString) {
    return dayjs(dateString).format("	MMM D, YYYY");
  });

  eleventyConfig.addHandlebarsHelper("filterObject", function (object, key) {
    return object[key];
  });

  // https://w3collective.com/calculate-reading-time-javascript/
  eleventyConfig.addHandlebarsHelper("readingTime", function (content) {
    const wpm = 225;
    const words = content.trim().split(/\s+/).length;

    return Math.ceil(words / wpm);
  });

  return {
    dir: {
      input: "src",
      output: "dist",
    },
  };
};
