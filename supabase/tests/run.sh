#!/usr/bin/env bash
# Local migration + SQL test runner (plain Postgres + stub). Usage: tests/run.sh
set -euo pipefail
cd "$(dirname "$0")/.."
DB=far_crm_test
PSQL="psql -v ON_ERROR_STOP=1 -q -X"
su postgres -c "dropdb --if-exists $DB && createdb $DB"
run() { su postgres -c "$PSQL -d $DB -f $PWD/$1"; }
run tests/00_local_supabase_stub.sql
for f in migrations/*.sql; do echo "applying $f"; run "$f"; done
run tests/01_helpers_fixtures.sql
run tests/10_followups.test.sql
run tests/20_security.test.sql
