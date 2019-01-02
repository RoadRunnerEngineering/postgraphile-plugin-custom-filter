# postgraphile-plugin-custom-filter
plugin for postgraphile that adds customized filter

Inspired by the postgraphile connection filter plugin, this plugin is to add a "CustomFilter" object in each of the Connection Arguments. Just by appending this plugin, the CustomFilter would be empty. It requires the user to add some code for the custom filters.

The plugin requires the user to code up the logic of custom filter yourself. When using this plugin, an option parameter must be specified. Currently the option parameter only needs a filters attribute, which consist of an object that describes all the filters to all the models. The structure of filter is

```javascript
filter = {
  modelName: {
    fieldName: {
      fieldType: 'String'|'Boolean'|'Int'|'Float',
      modifier: () => {},
    }
  }
}
```
This setup ensures that for each Model there's one object, and in that object, we add multiple fieldNames, for each fieldName, it should only have one object. This avoid adding duplicated fieldNames for different purposes.

```javascript
const plugin = require('postgraphile-plugin-custom-filter');

const options = {
  filters: {
    User: {
      foo: {
        fieldType: 'String',
        modifier: (queryBuilder, value, build) => { console.log(value); },
      }
    }
  }
};

buildPlugin = (build) => {
  plugin(build,options);
};

const express = require('express');
const { postgraphile } = require('postgraphile');

const app = express();

app.use(postgraphile(process.env.DATABASE_URL || 'postgres://localhost/', 'public', {
  appendPlugins: [
    // put the plugin in here
    buildPlugin,
  ],
}));

app.listen(process.env.PORT || 3000);
```
This will create a 'foo' field in CustomFilter, then after the postGraphile constructed the query, the hooks will call your modifier function with 4 parameters, the queryBuilder, (details in [QueryBuilder.js](https://github.com/graphile/graphile-build/blob/master/packages/graphile-build-pg/src/QueryBuilder.js)), the value of the 'foo' parameter, and two help object, 'build', and 'context'. These two objects are described more in  postGraphile plugin page. (see more in [plugins](https://www.graphile.org/graphile-build/plugins/) and [server plugin](https://www.graphile.org/postgraphile/extending/)).

These two pages helped a lot when writing your own plugins, but it still lacks a lot of details. To be more familiar with the hook system, a lot of digging through source was required. So I created this plugin so that it gives some freedom for others to add query based on their needs.

Let's see an example!

### Example

Suppose you have a UserConnection, this plugin will create a arg called CustomFilter in the UserConnect(xxx) parameter
`
allUsers(first: 10, CustomFilter: {...}){
}
`
Suppose the User is associated with a role with a `role_id` field. And Role have a column called `role_name`. You want to get all users that has `role_name='admin'`. This is hard to do because postgraphile does not support filter based on nested object attributes.
If you know the role_id, say

| id        | name  |
| --------- |:-----:|
| 1         | admin |

You can fake it by
```graphql
# the condition arg is already provided out of box with postGraphile
allUsers(first: 10, conditions: {role_id: 1}){
}
```

But what if it's more complicated?

#### Add extra where
Assume the postgraphile generates a correct query that does all other filter, order. What we want is to add an extra where statement.

We can use this customized filter, let's add a field roleName.

```javascript
const filter = {
  User: {
    byRoleName: {
      fieldType: 'String',
      modifier: (queryBuilder, value, build) => {
      // I'll get into it later
      },
    },
  },
};
```
This will allow you to query the users with a 'byRoleName' parameter, like this:
```graphql
allUsers(CustomFilter: {
  byRoleName: "admin"
}){
  nodes {
  ...
  }
}
```
Now we need to modify the queryBuilder when the request send `{byRoleName: "admin"}`
The way to do it is through that modifier function. The queryBuilder is the main object that postGraphile uses to create the query. There's not much documentation to it, but if you create breakpoints, and explore the object, you could see a lot of functions it provides. It also holds the currently created query.

Now we want to modify the query.
Intuitively, we want
```sql
select * from users
left join roles on users.role_id = roles.id
where roles.name = 'Admin';
```
But the queryBuilder don't let you do join, Instead we'll have to use an workaround.
```sql
select * from users
where users.id in (select id from users left join roles on users.role_id = roles.id where roles.name = 'Admin')
```
This subquery looks a lot more expensive, and if you are from the old days SQL, when join is much quicker than subquery, you probably gonna hate it. But postgres query optimizer does an amazing job that it eventually optimizes the query and produce the result without much time difference. (as long as you index these keys).

Now we know what to put in, but there is one more important thing. The queryBuilder does not allow just random string parameters, which means
```javascript
modifier = (queryBuilder, value, build) => {
  if (value) {
    queryBuilder.where("users.id in (select id from users left join roles on users.role_id = roles.id where roles.name = "+value+")");
  }
}
```
is not gonna work.

Also the queryBuilder actually uses alias for table names, so `"users.id"` won't work neither.

To get the table name we'll need `queryBuilder.getTableAlias()` function, and each field is a `pgSql.identifier`, each value is a `pgSQL.value`. (read more in [pgSql](https://github.com/graphile/pg-sql2/blob/master/README.md)).

So this where is convert to
```javascript
modifier = (queryBuilder, value, build) => {
  const { pgSql } = build;
  if (value) {
    queryBuilder.where(pgSql.query`${queryBuilder.getTableAlias()}.${pgSql.identifier('id')} in (${pgSql.query`select id from users left join roles on users.role_id = roles.id where roles.name = ${pgSql.value(value)}`})`);
  }
};
```

#### Tricks
Even though this plugin is called custom filter, it really opens up a lot of possibilities because you are exposed to the queryBuilder, the key of the queries. You could also sort it with
```javascript
queryBuilder.orderBy(pgSql.query`(select name from roles where roles.id = ${queryBuilder.getTableAlias()}.${pgSql.identifier('role_id')})`);
```
This will add a sorter to sort it by the role name. Of course you'll remember to not specify other orderBy.
A full example of sort by nested fields

```javascript
const filter = {
  User: {
    sortByRoleName: {
      fieldType: 'String',
      modifier: (queryBuilder, value, build) => {
        if (value) {
          queryBuilder.orderBy(pgSql.query`
            (select name from roles where roles.id = ${queryBuilder.getTableAlias()}.${pgSql.identifier('role_id')})
          `, true); // true/false means asc/desc
        }
      },
    },
  },
};
```
Then if you do a query
```graphql
allUsers(orderBy: [], customFilter: {
  sortByRoleName: true
}){
  node{
    name
  }
}
```
Then you'll be able to see the list of users that's sorted by the role name. However, if you do
```graphql
allUsers(orderBy: PRIMARY_KEY_ASC, customFilter: {
  sortByRoleName: true
}){
  node{
    name
  }
}
```
Then you won't be able to see the user list in correct order.

(Notice the `orderBy: []`, it is important to NOT specify any other orderBy). The `orderBy` function allows you to specify true/false as direction. If you do not specify order is unique (`queryBuilder.orderIsUnique()`). Then it will append the PRIMARY_KEY as a back up order after the initial order, which ensure the order is unique.

License MIT
Contact hansolo<han.lai321@gmail.com>
