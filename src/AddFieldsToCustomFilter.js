const pluralize = require('pluralize');


const ensureTypeExist = (fieldType, build) => {
  const {
    getTypeByName,
    graphql: {
      GraphQLString,
      GraphQLBoolean,
      GraphQLFloat,
      GraphQLInt,
    },
    addType,
  } = build;
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
  return TableFilterType;
};
/**
 * @description Add fields to the CustomFilter object. This function is put into the plugin
 * of postgraphile. It requires an options parameter, which the user specifies filters
 * @param {Object} builder The builder object provided by postgraphile
 * @param {Object} options A option object that consist information about the filters
 * @param {Object} options.filter This is required in options to build any filter. It should be an
 * Object with key-value pairs. key represent the model name, e.g. 'User'. value is the filter on
 * that model.
 * @param {Object} optiosn.filter[modelName] An object with key-value pairs for one model. The key
 * represent the field name, the value is an object.
 * @param {String} options.filter[modelName][fieldName] An object that should have three attributes.
 * @param {String} options.filter[modelName][fieldName].fieldType the fieldType, which is a string
 * represent the type of the filter value. e.g. { fieldType:'String'} or {fieldType:'Boolean'}
 * @param {Function} options.filter[modelName][fieldName].modifier The function that act as handler
 * for the query, it is passed three arguments
 * 1. queryBuilder, this is the builder object that stores the current sql build, use the object
 *   functions such as queryBuilder.where...
 * @link https://github.com/graphile/pg-sql2/blob/master/README.md
 * 2. value, the value is extracted from customFilter and passed to the function
 * 3. build, this object contains a lot of helpers to construct query, the most important one is
 * pgSql
 * 4. context, this is not as useful, but passing it in just in case.
 * @param {Object} options.filter[modelName][fieldName].options An option object that provice flexibility.
 * Current support descritipn attribute
 */
module.exports = function AddFieldsToCustomFilter(builder, options) {
  const { filters } = options;

  builder.hook('GraphQLInputObjectType:fields', (_, build, context) => {
    const {
      extend,
    } = build;
    const {
      Self: {
        name,
      },
    } = context;
    // It should be a CustomFilter Type
    if (!name.endsWith('CustomFilter')) return _;

    const modelName = name.substring(0, name.length - 12);// Use substring instead of replace
    const filterForModel = filters[modelName];
    // Skip it if it's not the right model
    if (!filterForModel) return _;
    const customFilter = {};
    Object.entries(filterForModel).forEach(([fieldName, filter]) => {
      const {
        fieldType, options: filterOptions,
      } = filter;
      const { description = `${fieldType} in custom filter` } = (filterOptions || {});
      const TableFilterType = ensureTypeExist(fieldType, build);
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
      // like 'UsersConnection' (notice it's plural)
      if (!returnName.endsWith('Connection')) return args;
      const modelName = pluralize.singular(returnName.substring(0, returnName.length - 10));
      const filterForModel = filters[modelName];
      // Skip it if it's not the right model
      if (!filterForModel) return args;

      Object.entries(filterForModel).forEach(([fieldName, filter]) => {
        const { fieldType, modifier } = filter;

        const TableFilterType = ensureTypeExist(fieldType, build);
        if (TableFilterType) {
        // Generate SQL where clause from filter argument
          addArgDataGenerator(({ customFilter }) => {
            const { [fieldName]: value } = (customFilter || {});
            return {
              pgQuery: (queryBuilder) => {
                modifier(queryBuilder, value, build, context);
              },
            };
          });
        }
      });
      return args;
    },
  );
};
