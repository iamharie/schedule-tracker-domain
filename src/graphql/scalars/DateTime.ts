import { GraphQLScalarType, Kind } from 'graphql';

export const DateTimeScalar = new GraphQLScalarType({
  name: 'DateTime',
  description: 'ISO 8601 UTC date-time string',
  serialize(value) {
    if (value instanceof Date) return value.toISOString();
    if (typeof value === 'string') return new Date(value).toISOString();
    throw new Error('DateTime cannot serialize non-Date value');
  },
  parseValue(value) {
    if (typeof value === 'string') return new Date(value);
    throw new Error('DateTime must be an ISO 8601 string');
  },
  parseLiteral(ast) {
    if (ast.kind === Kind.STRING) return new Date(ast.value);
    return null;
  },
});
