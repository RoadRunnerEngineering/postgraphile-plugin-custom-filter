module.export = function addStandardFilterToArgs(builder){
  builder.hook('init', (_, build) => {
    const {
      newWithHooks,
      getTypeByName,
      pgIntrospectionResultsByKind: introspectionResultsByKind,
      graphql: {
        GraphQLInputObjectType,
        GraphQLString,
      },
      inflection,
    } = build;
    // Add *CustomFilter type for each Connection type
    introspectionResultsByKind.class
      .filter(table => table.isSelectable)
      .filter(table => !!table.namespace)
      .forEach((table) => {
        const tableTypeName = inflection.tableType(table);
        const TableFilterType = getTypeByName(`${tableTypeName}CustomFilter`);
        if (!TableFilterType) {
          newWithHooks(
            GraphQLInputObjectType,
            {
              description: `A customized filter to be used against \`${tableTypeName}\` object types. All fields are combined with a logical ‘and.’`,
              name: `${tableTypeName}CustomFilter`,
              fields: (context) => {
                const { fieldWithHooks } = context;
                return {
                  _: fieldWithHooks('_', {
                    description: 'blah',
                    type: GraphQLString,
                  }),
                };
              },
            },
            {
              isPgCustomFilter: true,
            },
          );
        }
      });
    return _;
  });
  builder.hook(
    'GraphQLObjectType:fields:field:args',
    (args, build, context) => {
      const {
        extend,
        pgGetGqlTypeByTypeId,
        getTypeByName,
      } = build;
      const {
        scope: {
          isPgFieldConnection,
          isPgFieldSimpleCollection,
          pgFieldIntrospection: source,
        },
        field,
        Self,
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
      const returnTypeId =
        source.kind === 'class' ? source.type.id : source.returnTypeId;
      const tableTypeName = pgGetGqlTypeByTypeId(returnTypeId, null).name;
      // Only add it to the spedified connection
      const TableFilterType = getTypeByName(`${tableTypeName}CustomFilter`);
      if (TableFilterType == null) {
        return args;
      }

      return extend(
        args,
        {
          customFilter: {
            description: 'Custom Filter',
            type: TableFilterType,
          },
        },
        `Adding connection parent arg to field '${field.name}' of '${
          Self.name
        }'`,
      );
    },
  );
};
