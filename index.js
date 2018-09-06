module.exports = function PostGraphileCustomFilterPlugin(builder) {
  require("./src/AddCustomFilterToArgs.js")(builder);
};