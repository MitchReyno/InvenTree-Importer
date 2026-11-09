# Media decoder

The program that runs inside the pinned, network-less media container. It decodes one retained original (image or PDF) into normalized pages, crops and WebP renditions, and writes a framed result to stdout. It never touches the database, the blob store or the network.

- `src/decoder-main.ts` is the container entry point; it reads one request from stdin.
- `src/decode.ts` and `src/rotated-region.ts` do the decoding with `sharp`, `pdfjs-dist` and `@napi-rs/canvas`.
- `src/decoder-protocol.ts` holds the request and result types and the limits. It is the only module the intake server imports, as `@invimport/media-decoder/protocol`.

The intake server builds the image (`intake-server/scripts/build-media-image.cjs`), runs it (`intake-server/src/media/decoder-runner.ts`) and parses its output (`intake-server/src/media/decoder-output.ts`). See the [retained media boundary](../intake-server/ARCHITECTURE.md#retained-media-and-additive-attachment-execution) for the container limits and the worker.

Run `pnpm --filter @invimport/media-decoder test` for the decoding tests. The container itself is qualified by the intake server's process tier.
