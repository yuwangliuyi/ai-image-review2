import importlib.util
import sqlite3
import tempfile
import unittest
from contextlib import closing
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('migration', ROOT / 'scripts/migrate-database.py')
migration = importlib.util.module_from_spec(spec)
spec.loader.exec_module(migration)


class MigrationTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.db = self.root / 'validation.db'
        with closing(sqlite3.connect(self.db)) as c, c:
            c.executescript((ROOT / 'prisma/legacy-schema.sql').read_text())
            c.execute("INSERT INTO User VALUES ('old-id','original','','team','private-hash','ADMIN',1,1)")
            c.execute("INSERT INTO Spu VALUES ('spu-id','existing','','','','PENDING','old-id',NULL,'team',1,1)")

    def test_preview_is_read_only(self):
        before = self.db.read_bytes()
        result = migration.migrate(self.db)
        self.assertEqual(result['pending_migrations'], 3)
        self.assertEqual(self.db.read_bytes(), before)
        self.assertEqual(list(self.root.iterdir()), [self.db])

    def test_apply_preserves_business_and_produces_restorable_backup(self):
        result = migration.migrate(self.db, apply=True, backup_directory=self.root / 'backups')
        self.assertEqual(result['schema_version'], 3)
        backup = Path(result['backup'])
        self.assertEqual(backup.stat().st_mode & 0o777, 0o600)
        for db in (self.db, backup):
            with closing(sqlite3.connect(db)) as c:
                self.assertEqual(c.execute('PRAGMA integrity_check').fetchone()[0], 'ok')
                self.assertEqual(c.execute('SELECT id,role,password FROM User').fetchall(), [('old-id','ADMIN','private-hash')])
                self.assertEqual(c.execute('SELECT uploadedById FROM Spu').fetchall(), [('old-id',)])
        with closing(sqlite3.connect(backup)) as c:
            self.assertFalse(c.execute("SELECT 1 FROM sqlite_master WHERE name='SsoSetupState'").fetchone())
        files = sorted((self.root / 'backups').iterdir())
        self.assertTrue(migration.migrate(self.db, apply=True, backup_directory=self.root / 'backups')['unchanged'])
        self.assertEqual(sorted((self.root / 'backups').iterdir()), files)

    def test_unknown_schema_is_rejected_without_changes(self):
        with closing(sqlite3.connect(self.db)) as c, c:
            c.execute('ALTER TABLE User ADD COLUMN unexpected TEXT')
        before = self.db.read_bytes()
        with self.assertRaisesRegex(ValueError, '结构'):
            migration.migrate(self.db, apply=True, backup_directory=self.root / 'backups')
        self.assertEqual(self.db.read_bytes(), before)
        self.assertFalse((self.root / 'backups').exists())

    def test_backup_contains_committed_wal_rows(self):
        writer = sqlite3.connect(self.db)
        self.addCleanup(writer.close)
        writer.execute('PRAGMA journal_mode=WAL')
        writer.execute("UPDATE User SET department='latest-committed'")
        writer.commit()
        result = migration.migrate(self.db, apply=True, backup_directory=self.root / 'backups')
        with closing(sqlite3.connect(result['backup'])) as c:
            self.assertEqual(c.execute('SELECT department FROM User').fetchone()[0], 'latest-committed')

    def test_apply_requires_backup_and_rejects_empty_database(self):
        with self.assertRaisesRegex(ValueError, '备份'):
            migration.migrate(self.db, apply=True)
        empty = self.root / 'empty.db'
        empty.touch()
        with self.assertRaisesRegex(ValueError, '结构'):
            migration.migrate(empty, apply=True, backup_directory=self.root / 'backups')


if __name__ == '__main__':
    unittest.main()
