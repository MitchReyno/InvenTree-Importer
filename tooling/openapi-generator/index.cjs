const openapiTS = require('openapi-typescript').default
const { astToString } = require('openapi-typescript')
const ts = require('typescript')

/** Public Node transform: binary bodies are Blob, using the isolated TypeScript 5 AST. */
module.exports = async function generateOpenApiTypes(document) {
  return astToString(
    await openapiTS(document, {
      transform(schema) {
        if (schema.type === 'string' && schema.format === 'binary') {
          return ts.factory.createTypeReferenceNode(ts.factory.createIdentifier('Blob'))
        }
      },
    }),
  )
}
