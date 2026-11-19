import os
import subprocess
import unittest

import test_migrate_database as database_test

ROOT = database_test.ROOT
migration = database_test.migration


class StartupTest(unittest.TestCase):
    setUp = database_test.MigrationTest.setUp

    def run_check(self, **overrides):
        env = {**os.environ, 'DATABASE_URL': 'file:' + str(self.db),
               'NEXTAUTH_SECRET': 'synthetic-startup-test-secret-32-characters',
               'AUTH_COOKIE_PREFIX': 'ai-review-sso90-test', 'NEXTAUTH_URL': 'http://127.0.0.1:3003',
               'AI_REVIEW_INSTANCE_MODE': 'validation', 'JX_SSO_ONBOARDING_MODE': 'guided',
               'JX_SSO_APP_ID': 'APP_TEST', 'JX_SSO_ENVIRONMENT': 'test',
               'JX_SSO_WEB_URL': 'http://127.0.0.1:9000', 'JX_SSO_API_URL': 'http://127.0.0.1:9000/sso',
               **overrides}
        return subprocess.run(['node', 'scripts/check-database.mjs'], cwd=ROOT, env=env,
                              capture_output=True, text=True, timeout=20)

    def test_old_or_missing_database_fails_without_initialization(self):
        before = self.db.read_bytes()
        result = self.run_check()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('迁移', result.stderr)
        self.assertEqual(self.db.read_bytes(), before)
        missing = self.root / 'missing.db'
        self.assertNotEqual(self.run_check(DATABASE_URL='file:' + str(missing)).returncode, 0)
        self.assertFalse(missing.exists())

    def test_migrated_database_passes_without_writes(self):
        migration.migrate(self.db, apply=True, backup_directory=self.root / 'backups')
        before = self.db.read_bytes()
        result = self.run_check()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.db.read_bytes(), before)

    def test_shared_cookie_and_absent_secret_are_rejected(self):
        self.assertNotEqual(self.run_check(AUTH_COOKIE_PREFIX='next-auth').returncode, 0)
        self.assertNotEqual(self.run_check(NEXTAUTH_SECRET='').returncode, 0)
        self.assertNotEqual(self.run_check(JX_SSO_APP_ID='').returncode, 0)
