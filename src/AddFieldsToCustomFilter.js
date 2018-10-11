const pluralize = require('pluralize');

/**
 * @summary Returns field type inside list if given field type is a list
 * @param fieldType
 * @returns {*}
 */
const getListType = (fieldType) => {
  if (fieldType.startsWith('[') && fieldType.endsWith(']')) {
    return fieldType.slice(1, -1);
  }
  return null;
};

/**
 * @summary Returns field type without ! if given field type is a non-null
 * @param fieldType
 * @returns {*}
 */
const getNonNullType = (fieldType) => {
  if (fieldType.endsWith('!')) {
    return fieldType.slice(0, -1);
  }
  return null;
};

/**
 * @summary Given a field type, returns base field and
 * information about whether it is a list or non null
 * @param type
 * @returns {{isList: boolean, isNonNull: boolean, isNonNullList: boolean, fieldType: *}}
 */
const getTypeInfo = (type) => {
  const nonNullType = getNonNullType(type);
  let fieldType = nonNullType || type;

  const listType = getListType(fieldType);
  fieldType = listType || fieldType;

  const nonNullListType = getNonNullType(fieldType);
  fieldType = nonNullListType || fieldType;

  return {
    isList: !!listType,
    isNonNull: !!nonNullType,
    isNonNullList: !!nonNullListType,
    fieldType,
  };
};

const ensureTypeExist = (fieldType, build) => {
  const {
    getTypeByName,
    graphql: {
      GraphQLString,
      GraphQLBoolean,
      GraphQLFloat,
      GraphQLInt,
      GraphQLList,
      GraphQLNonNull,
    },
    addType,
  } = build;
  const typeInfo = getTypeInfo(fieldType);

  let TableFilterType = getTypeByName(typeInfo.fieldType);
  if (TableFilterType == null) {
    switch (typeInfo.fieldType) {
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

  if (TableFilterType && typeInfo.isNonNull) {
    TableFilterType = GraphQLNonNull(TableFilterType);
  }

  if (TableFilterType && typeInfo.isList) {
    TableFilterType = GraphQLList(TableFilterType);

    if (typeInfo.isNonNullList) {
      TableFilterType = GraphQLNonNull(TableFilterType);
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
 * @author Han Lai<han@roadrunnerwm.com>
 * @author Adam Darr<adarr@roadrunnerwm.com>
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
        !shouldAddFilter
        || !source
        || (source.kind !== 'class'
          && (source.kind !== 'procedure'))
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
