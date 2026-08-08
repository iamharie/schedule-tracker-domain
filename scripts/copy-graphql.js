const { cpSync, mkdirSync } = require('fs');
const { join } = require('path');

const src = join(__dirname, '../src/graphql/schema');
const dest = join(__dirname, '../dist/graphql/schema');

mkdirSync(dest, { recursive: true });
cpSync(src, dest, { recursive: true });
console.log('✅ Copied GraphQL schema files to dist/graphql/schema/');
