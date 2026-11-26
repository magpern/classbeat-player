// Usage (from schema/ts): npm run build:reader
import { readFileSync, writeFileSync } from "node:fs";
import { readerValidatorSource } from "./reader-validator-source.ts";

const schema = JSON.parse(readFileSync(new URL("../../class-format/v1/class.schema.json", import.meta.url), "utf8"));
writeFileSync(new URL("../src/reader-validator.generated.ts", import.meta.url), readerValidatorSource(schema));
