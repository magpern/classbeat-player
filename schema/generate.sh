#!/usr/bin/env bash
# Regenerate the Python (Pydantic v2) and TypeScript types from the JSON Schemas.
# Tool versions are pinned in python/uv.lock and ts/package-lock.json.
# Usage: schema/generate.sh [output-root]   (default: schema/generated)
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
out="${1:-$here/generated}"
v1="$here/class-format/v1"

mkdir -p "$out/python" "$out/ts"

# Python. One module per schema; the publication module imports the class module.
uv run --project "$here/python" --frozen datamodel-codegen \
  --input "$v1/class.schema.json" --input-file-type jsonschema \
  --output "$out/python/class_model.py" \
  --output-model-type pydantic_v2.BaseModel --target-python-version 3.12 \
  --use-standard-collections --use-union-operator --use-annotated --field-constraints \
  --disable-timestamp --use-title-as-name --extra-fields forbid --formatters black isort
uv run --project "$here/python" --frozen datamodel-codegen \
  --input "$v1/publication.schema.json" --input-file-type jsonschema \
  --output "$out/python/publication_model.py" \
  --output-model-type pydantic_v2.BaseModel --target-python-version 3.12 \
  --use-standard-collections --use-union-operator --use-annotated --field-constraints \
  --disable-timestamp --use-title-as-name --extra-fields forbid --formatters black isort

# TypeScript. The publication type declares the class type it references.
npm --prefix "$here/ts" exec --no -- json2ts \
  --input "$v1/class.schema.json" --output "$out/ts/class.d.ts" \
  --cwd "$v1" --no-additionalProperties --unreachableDefinitions=false
npm --prefix "$here/ts" exec --no -- json2ts \
  --input "$v1/publication.schema.json" --output "$out/ts/publication.d.ts" \
  --cwd "$v1" --no-additionalProperties --declareExternallyReferenced
