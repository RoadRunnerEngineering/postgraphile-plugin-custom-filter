const pluralize = require('pluralize');
/**
 * @description Add fields to the CustomFilter object. This function is put into the plugin
 * of postgraphile. It requires an options parameter, which the user specifies filters
 * @param {Object} builder The builder object provided by postgraphile
 * @param {Object} options A option object that consist information about the filters
 * @param {Array} options.filter This is required in options to build any filter. It should be an
 * Array of filter object. Each filter object should have 4 attributes.
 * @param {Object} optiosn.filter[0] A object that consist of a filter. It should have 4 fields
 * @param {String} options.filter[0].modelName The model name, eg. User
 * @param {String} options.filter[0].fieldName  The name of the newly added field. Make sure this
 * field is not conflict with any other arguments
 * @param {String} options.filter[0].fieldType  Type of field, supports "String", "Boolean", "Int"
 * @param {Function} modifier The function that act as handler for the query, it is passed
 * three arguments
 * 1. queryBuilder, this is the builder object that stores the current sql build, use the object
 *   functions such as queryBuilder.where...
 * @link https://github.com/graphile/pg-sql2/blob/master/README.md
 * 2. value, the value is extracted from customFilter and passed to the function
 * 3. build, this object contains a lot of helpers to construct query, the most important one is
 * pgSql
 * 4. context, this is not as useful, but passing it in just in case.
 */
module.exports = function AddFieldsToCustomFilter(builder, options) {
  const { filters } = options;

  builder.hook('GraphQLInputObjectType:fields', (_, build, context) => {
    const {
      extend,
      getTypeByName,
      graphql: {
        GraphQLString,
        GraphQLBoolean,
        GraphQLFloat,
        GraphQLInt,
      },
      addType,
    } = build;
    const {
      Self: {
        name,
      },
    } = context;
    // Look for filters
    const filterList = filters.filter(f => name === `${f.modelName}CustomFilter`);
    // Skip the ones that are not the target
    if (filterList.length < 1) return _;
    const customFilter = {};
    filterList.forEach((filter) => {
      const {
        fieldName, fieldType, option,
      } = filter;
      const { description = `${fieldType} in custom filter` } = (option || {});
      let TableFilterType = getTypeByName(fieldType);
      if (TableFilterType == null) {
        switch (fieldType) {
          case 'Boolean': {
            TableFilterType = GraphQLBoolean;
            break;
          }
          case 'String': {
            TableFilterType = GraphQLString;
            break;
          }
          case 'Int': {
            TableFilterType = GraphQLInt;
            break;
          }
          case 'Float': {
            TableFilterType = GraphQLFloat;
            break;
          }
          default:
            TableFilterType = null;
        }
        if (TableFilterType) {
          addType(TableFilterType);
        }
      }
      if (TableFilterType) {
        // Add this filter to the customFilter object
        customFilter[fieldName] = {
          description,
          type: TableFilterType,
        };
      }
    });


    // In the ConnectCustomFilter object, extend it with a field
    return extend(
      _,
      customFilter,
      `Adding fields to CustomFilter that is in connection arg to field '${name}'`,
    );
  });
  // Add handler for the custom filter
  builder.hook(
    'GraphQLObjectType:fields:field:args',
    (args, build, context) => {
      const {
        addType,
        getTypeByName,
        graphql: {
          GraphQLString,
          GraphQLInt,
          GraphQLFloat,
          GraphQLBoolean,
        },
      } = build;
      const {
        scope: {
          isPgFieldConnection,
          isPgFieldSimpleCollection,
          pgFieldIntrospection: source,
        },
        addArgDataGenerator,
        field,
      } = context;
      const shouldAddFilter = isPgFieldConnection || isPgFieldSimpleCollection;
      if (
        !shouldAddFilter ||
        !source ||
        (source.kind !== 'class' &&
          (source.kind !== 'procedure'))
      ) {
        return args;
      }
      const returnName = field.type.ofType ? field.type.ofType.name : field.type.name;
      // Only add it to the spedified connection
      // like 'LocationsConnection'

      const filterList = filters.filter((f) => {
        const connectionName = `${pluralize.plural(f.modelName)}Connection`;
        return returnName === connectionName;
      });
      if (filterList.length < 1) return args;
      filterList.forEach((filter) => {
        const { fieldType, fieldName, modifier } = filter;
        // Add filter argument for each Connection
        let TableFilterType = getTypeByName(fieldType);
        if (TableFilterType == null) {
          switch (fieldType) {
            case 'Boolean': {
              TableFilterType = GraphQLBoolean;
              break;
            }
            case 'String': {
              TableFilterType = GraphQLString;
              break;
            }
            case 'Int': {
              TableFilterType = GraphQLInt;
              break;
            }
            case 'Float': {
              TableFilterType = GraphQLFloat;
              break;
            }
            default:
              TableFilterType = null;
          }
          if (TableFilterType) {
            addType(TableFilterType);
          }
        }
        if (!TableFilterType) {
          return args;
        }
        // Generate SQL where clause from filter argument
        addArgDataGenerator(({ customFilter }) => {
          const { [fieldName]: value } = (customFilter || {});
          return {
            pgQuery: (queryBuilder) => {
              modifier(queryBuilder, value, build, context);
            },
          };
        });
      });
      return args;
    },
  );
};
