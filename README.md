# postgraphile-plugin-custom-filter
plugin for postgraphile that adds customized filter

Inspired by the postgraphile connection filter plugin, this plugin is to add a "CustomFilter" object in each of the Connection Arguments. Just by appending this plugin, the CustomFilter would be empty. It requires the user to add some code for the custom filters. 

### Example

Suppose you have a UserConnection, this plugin will create a arg called CustomFilter in the UserConnect(xxx) parameter
`
allUsers(first:10,CustomFilter:{...}){
}
`
But just by itself, it does do anything. Suppose the User is associated with a role with a role_id field. And Role have a column called role_name. You want to get all users that has role_name='admin'. This is hard to do because postgraphile does not support filter based on nested object attributes. 

#### Add extra where
Assume the postgraphile generates a correct query that does all other filter, order. What we want is to add an extra where statement. 

We can use this customized filter, let's add a field roleName.

```
