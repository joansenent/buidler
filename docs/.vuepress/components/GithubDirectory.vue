<template>
  <div id="app">See browser console</div>
</template>

<script>
import axios from "axios";
import cheerio from "cheerio";

export default {
  name: "App",
  created() {
    this.fetchUrl();
  },
  methods: {
    fetchUrl() {
      axios
        .get(
          "https://github.com/nomiclabs/buidler/tree/master/packages/buidler-core/src/builtin-tasks"
        )
        .then(response => {
          const $ = cheerio.load(response.data);
          const $els = $(
            ".repository-content .js-navigation-item:not(.up-tree) .js-navigation-open"
          );

          const taskNames = Array.from($els.contents())
            .map(c => c.data)
            .filter(t => t.slice(-3) === ".ts");

          console.log("available built-in tasks are:", taskNames);

          /* HTML render the doc
              $.root().html()
              //=>  <html>
              //      <head></head>
              //      <body>
              //        <ul id="fruits">
              //          <li class="apple">Apple</li>
              //          <li class="orange">Orange</li>
              //          <li class="pear">Pear</li>
              //        </ul>
              //      </body>
              //    </html>
          * */
        });
    }
  }
};
</script>
