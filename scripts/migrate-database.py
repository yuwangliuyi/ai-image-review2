#!/usr/bin/env python3
"""Review/apply the two additive SSO migrations to an isolated legacy DB copy."""
import argparse
import hashlib
import json
import os
import sqlite3
import uuid
from datetime import datetime, timezone
from contextlib import closing
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MIGRATIONS = [
    ROOT / 'prisma/migrations/20261014000000_add_jx_sso_guided/migration.sql',
    ROOT / 'prisma/migrations/20261015000000_add_dingtalk_identities/migration.sql',
    ROOT / 'prisma/migrations/20261118000000_roster/migration.sql',
]
BUSINESS_TABLES = ('Archive', 'Image', 'Notification', 'ReviewRecord', 'Spu', 'User')


def connect(path, mode):
    return sqlite3.connect(path.as_uri() + '?mode=' + mode, uri=True, timeout=10)


def quote(name):
    return '"' + name.replace('"', '""') + '"'


def schema(connection):
    result = {}
    objects = connection.execute(
        "SELECT type,name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY name"
    ).fetchall()
    for kind, name in objects:
        if kind == 'table':
            columns = connection.execute('PRAGMA table_info(' + quote(name) + ')').fetchall()
            foreign_keys = connection.execute('PRAGMA foreign_key_list(' + quote(name) + ')').fetchall()
            result[name] = {'columns': columns, 'foreign_keys': foreign_keys, 'indexes': []}
            for index in connection.execute('PRAGMA index_list(' + quote(name) + ')'):
                info = connection.execute('PRAGMA index_info(' + quote(index[1]) + ')').fetchall()
                result[name]['indexes'].append((index[1], index[2], index[3], index[4], info))
            result[name]['indexes'].sort()
        elif kind != 'index':
            raise ValueError('数据库结构含未审核的视图或触发器，请先人工核查')
    return result


def expected_schemas():
    with closing(sqlite3.connect(':memory:')) as reference:
        reference.executescript((ROOT / 'prisma/legacy-schema.sql').read_text())
        versions = [schema(reference)]
        for migration in MIGRATIONS:
            reference.executescript(migration.read_text())
            versions.append(schema(reference))
        return versions


def version(connection, versions):
    current = schema(connection)
    for index, expected in enumerate(versions):
        if current == expected:
            return index
    raise ValueError('数据库结构与已审核的 90 旧版及增量迁移不符；未作变更')


def check(connection):
    if connection.execute('PRAGMA integrity_check').fetchall() != [('ok',)]:
        raise ValueError('数据库完整性检查失败')
    if connection.execute('PRAGMA foreign_key_check').fetchone():
        raise ValueError('数据库存在外键缺失，请先核查')


def business_digest(connection, baseline):
    digest = hashlib.sha256()
    counts = {}
    for table in BUSINESS_TABLES:
        columns = [column[1] for column in baseline[table]['columns']]
        query = 'SELECT ' + ','.join(map(quote, columns)) + ' FROM ' + quote(table) + ' ORDER BY id'
        count = 0
        for row in connection.execute(query):
            digest.update(json.dumps([table, row], ensure_ascii=True).encode())
            digest.update(b'\n')
            count += 1
        counts[table] = count
    return digest.hexdigest(), counts


def apply_sql(connection, path):
    # executescript() implicitly commits; execute each complete statement instead.
    statement = ''
    for line in path.read_text().splitlines(keepends=True):
        statement += line
        if sqlite3.complete_statement(statement):
            connection.execute(statement)
            statement = ''
    if statement.strip():
        raise ValueError('迁移 SQL 结尾不完整')


def migrate(database, apply=False, backup_directory=None):
    database = Path(database).resolve(strict=True)
    if apply and not backup_directory:
        raise ValueError('应用迁移必须指定独立备份目录')
    if apply and (database.is_relative_to('/data/ai-image-review') or
                  any(part in ('ai-image-review2', 'ai-image-review2 copy') for part in database.parts)):
        raise ValueError('禁止原地迁移旧实例；请先创建独立副本')
    versions = expected_schemas()
    source = connect(database, 'ro')
    try:
        current_version = version(source, versions)
        check(source)
        _, counts = business_digest(source, versions[0])
    finally:
        source.close()
    result = {'database': str(database), 'schema_version': current_version,
              'pending_migrations': len(MIGRATIONS) - current_version,
              'business_counts': counts, 'applied': False, 'unchanged': current_version == len(MIGRATIONS)}
    if not apply or result['unchanged']:
        return result

    writer = connect(database, 'rw')
    try:
        writer.execute('PRAGMA foreign_keys=ON')
        # Reserve the writer before the backup: no concurrent commit can slip between them.
        writer.execute('BEGIN IMMEDIATE')
        if version(writer, versions) != current_version:
            raise ValueError('数据库结构在预检后发生变化，请重新执行')
        check(writer)
        before = business_digest(writer, versions[0])
        backup_directory = Path(backup_directory).resolve()
        backup_directory.mkdir(parents=True, exist_ok=True, mode=0o700)
        backup_directory.chmod(0o700)
        stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
        backup_path = backup_directory / ('before-sso-' + stamp + '-' + uuid.uuid4().hex[:8] + '.db')
        fd = os.open(backup_path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
        os.close(fd)
        source = connect(database, 'ro')
        backup = connect(backup_path, 'rw')
        try:
            source.backup(backup)
            check(backup)
            if business_digest(backup, versions[0]) != before:
                raise ValueError('备份与待迁移数据库不一致，已取消迁移')
        finally:
            source.close()
            backup.close()
        for migration in MIGRATIONS[current_version:]:
            apply_sql(writer, migration)
        if version(writer, versions) != len(MIGRATIONS):
            raise ValueError('迁移后结构不符合预期')
        check(writer)
        if business_digest(writer, versions[0]) != before:
            raise ValueError('迁移改变了原业务数据，已回滚')
        writer.commit()
        result.update(schema_version=len(MIGRATIONS), pending_migrations=0, applied=True,
                      backup=str(backup_path), backup_sha256=hashlib.sha256(backup_path.read_bytes()).hexdigest(),
                      business_counts=before[1])
        return result
    except Exception:
        writer.rollback()
        raise
    finally:
        writer.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--database', required=True, type=Path, help='独立副本的绝对路径；默认仅预览')
    parser.add_argument('--apply', action='store_true', help='明确应用增量迁移')
    parser.add_argument('--backup-directory', type=Path, help='应用前一致性备份的独立目录')
    args = parser.parse_args()
    if not args.database.is_absolute():
        parser.error('--database 必须为绝对路径')
    try:
        print(json.dumps(migrate(args.database, args.apply, args.backup_directory), ensure_ascii=False, indent=2))
    except (ValueError, OSError, sqlite3.Error) as error:
        parser.exit(1, str(error) + '\n')


if __name__ == '__main__':
    main()
