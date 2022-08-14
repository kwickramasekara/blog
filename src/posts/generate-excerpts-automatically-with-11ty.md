---
title: Generate excerpts automatically with 11ty
date: 2022-08-13T03:23:10.474Z
tags: technology
---

We usually have to add descriptions as meta tags for SEO and social media sharing. This can be a tedious process if done manually because you also need to make sure the content is within 150-160 characters per [SEO guidelines](https://moz.com/learn/seo/meta-description). Fortunately, this can be automated with a filter to create an excerpt from page content, and it works great for blog posts.

For this little script, we can use some of the filters that Nunjucks already provides. Since eleventy has a dependency on Nunjucks, we can use them without having to install any additional packages.

So first, import Nunjucks filters into your eleventy config:

```js
const njkFilters = require("nunjucks/src/filters");
```

Next, add the filter inside main function as below:

```js
module.exports = function (eleventyConfig) {
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

      // limit description length per SEO guidelines
      paragraphContent = paragraphContent
        ? njkFilters.truncate(paragraphContent, 160)
        : null;

      return paragraphContent;
    }

    return null;
  });
};
```

What is happening above is as follows:

1. Check to see if content has anything.
2. Get the first paragraph element from the HTML content.
3. Use Nunjucks filter to convert the array received in previous step into a string.
4. Use Nunjucks filter to convert all HTML into text content. This means if you have any anchor elements inside the paragraph, those will get converted to plain text as well.
5. Finally, truncate the blob of text to 160 characters to satisfy SEO guidelines. This will also include ellipsis at the end if the string was truncated. If you want to change behavior of the truncation, please see [Nunjucks documentation](https://mozilla.github.io/nunjucks/templating.html#truncate)

Now, you can use this filter in any of the Nunjucks templates to add an excerpt as meta description:

```js
{% raw %}<meta name="description" content="{{ content | metaDescription }}" />{% endraw %}
```

Excerpt generated from this page as an example:

> We usually have to add descriptions as meta tags for SEO and social media sharing. This can be a tedious process if done manually because you also need to make....
