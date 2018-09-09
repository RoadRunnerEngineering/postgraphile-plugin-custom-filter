const AddCustomFilterToArgs = require('./src/AddCustomFilterToArgs');
const AddFieldsToCustomFilter = require('./src/AddFieldsToCustomFilter');

module.exports = function PostGraphileCustomFilterPlugin(builder, options) {
  AddCustomFilterToArgs(builder, options);
  AddFieldsToCustomFilter(builder, options);
};
