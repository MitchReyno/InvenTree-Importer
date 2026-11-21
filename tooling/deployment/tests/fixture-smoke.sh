#!/bin/sh
# Validate the release fixture independently of the developer's Compose project.
set -eu
fixture_dir=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
fixture_state=$(mktemp -d)
project="bi-release-$(basename "$fixture_state" | tr '[:upper:].' '[:lower:]-')"
compose() {
  docker compose --project-name "$project" --file "$fixture_dir/fixture.compose.yaml" "$@"
}
cleanup() {
  compose down --volumes && rmdir "$fixture_state"
}
trap cleanup EXIT
compose up --wait --wait-timeout 60 database
compose exec -T database psql -X --set ON_ERROR_STOP=1 -U postgres -d intake_release_fixture <<'SQL'
CREATE TABLE qualification_marker (value integer NOT NULL);
INSERT INTO qualification_marker VALUES (1);
SELECT * FROM qualification_marker;
SQL
