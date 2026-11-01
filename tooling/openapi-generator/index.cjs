const openapiTS = require('openapi-typescript').default
const { astToString } = require('openapi-typescript')

/** The generator's declared TypeScript 5 peer stays isolated from application compilers. */
module.exports = async function generateOpenApiTypes(document) {
  return astToString(await openapiTS(document))
}
