const dayjs = require("dayjs");

module.exports = function (eleventyConfig) {
  eleventyConfig.addWatchTarget("./src/styles/");

  eleventyConfig.addHandlebarsHelper("formatDate", function (dateString) {
    return dayjs(dateString).format("	MMM D, YYYY");
  });

  eleventyConfig.addHandlebarsHelper("filterObject", function (object, key) {
    return object[key];
  });

  return {
    dir: {
      input: "src",
      output: "dist",
    },
  };
};
