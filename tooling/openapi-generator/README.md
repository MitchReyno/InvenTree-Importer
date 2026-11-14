# OpenAPI generation tool

This private workspace package isolates openapi-typescript 7.13.0 and its declared-compatible TypeScript 5.9.3 peer. Application compilers stay on the workspace's TypeScript 6.0.3. The contracts package consumes this only as a development dependency; browser clients import openapi-fetch, not the generator/compiler.

The CommonJS entry accepts the in-memory OpenAPI object and returns generated declarations through the maintained Node API. Run `pnpm contracts:generate` from root, then `pnpm contracts:check` and `pnpm typecheck` to verify drift and actual TypeScript 6 consumers. Generator package installation uses strict peer checking without a blanket exception.

Do not import this tooling package from runtime application source. Its declarations express compile-time contracts; runtime validation remains in contracts through TypeBox/AJV.
