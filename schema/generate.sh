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

# The player API's answers (ADR 0002, section 7). The class answer's `document` references the
# class schema: its Python module imports the class model, its TypeScript file declares it.
api="$here/player-api/v1"
for name in changes cursor error class; do
  uv run --project "$here/python" --frozen datamodel-codegen \
    --input "$api/$name.schema.json" --input-file-type jsonschema \
    --output "$out/python/player_api_$name.py" \
    --output-model-type pydantic_v2.BaseModel --target-python-version 3.12 \
    --use-standard-collections --use-union-operator --use-annotated --field-constraints \
    --disable-timestamp --use-title-as-name --extra-fields forbid --formatters black isort
  npm --prefix "$here/ts" exec --no -- json2ts \
    --input "$api/$name.schema.json" --output "$out/ts/player-api-$name.d.ts" \
    --cwd "$api" --no-additionalProperties --declareExternallyReferenced
done

# The site's answers for a site session (ADR 0002, section 4). One module per schema:
# schema/site-api/v1/<name>.schema.json -> site_api_<name>.py and site-api-<name>.d.ts.
# Booleans are strict: the models refuse "true" or 1 where the schema says boolean. A bounded
# list stays a plain array in TypeScript (`--maxItems -1`), not a union of tuples; the schema
# and the Python model keep the bound.
site="$here/site-api/v1"
for path in "$site"/*.schema.json; do
  name="$(basename "$path" .schema.json)"
  uv run --project "$here/python" --frozen datamodel-codegen \
    --input "$path" --input-file-type jsonschema \
    --output "$out/python/site_api_${name//-/_}.py" \
    --output-model-type pydantic_v2.BaseModel --target-python-version 3.12 \
    --use-standard-collections --use-union-operator --use-annotated --field-constraints \
    --disable-timestamp --use-title-as-name --extra-fields forbid --formatters black isort \
    --strict-types bool
  npm --prefix "$here/ts" exec --no -- json2ts \
    --input "$path" --output "$out/ts/site-api-$name.d.ts" \
    --cwd "$site" --no-additionalProperties --maxItems -1
done

# The live sessions' HTTP bodies and WebSocket messages (ADR 0005, section 4). One module per
# schema: schema/live/v1/<name>.schema.json -> live_<name>.py and live-<name>.d.ts.
live="$here/live/v1"
for path in "$live"/*.schema.json; do
  name="$(basename "$path" .schema.json)"
  uv run --project "$here/python" --frozen datamodel-codegen \
    --input "$path" --input-file-type jsonschema \
    --output "$out/python/live_${name//-/_}.py" \
    --output-model-type pydantic_v2.BaseModel --target-python-version 3.12 \
    --use-standard-collections --use-union-operator --use-annotated --field-constraints \
    --disable-timestamp --use-title-as-name --extra-fields forbid --formatters black isort
  npm --prefix "$here/ts" exec --no -- json2ts \
    --input "$path" --output "$out/ts/live-$name.d.ts" \
    --cwd "$live" --no-additionalProperties
done
