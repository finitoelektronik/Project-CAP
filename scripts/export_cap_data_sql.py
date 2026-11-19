"""Ekspor data operasional CAP ke migrasi SQL non-destruktif."""
import sqlite3
import sys
from pathlib import Path

EXCLUDED_TABLES = {
    "app_users",              # akun dan kata sandi dikelola pada server tujuan
    "module_installations",   # riwayat pemasangan bersifat lokal untuk setiap server
    "module_migrations",      # jangan menandai migrasi lain sebagai telah terpasang
    "whatsapp_settings",      # dapat memuat access token Meta
}


def identifier(value):
    return '"' + value.replace('"', '""') + '"'


def value_sql(value, omit_binary=False):
    if value is None:
        return "NULL"
    if isinstance(value, bytes):
        if omit_binary:
            return "X''"
        return "X'" + value.hex() + "'"
    if isinstance(value, str):
        return "'" + value.replace("'", "''") + "'"
    if isinstance(value, float):
        return repr(value)
    return str(value)


def export_data(database, output):
    connection = sqlite3.connect(database)
    connection.row_factory = sqlite3.Row
    tables = [
        row[0]
        for row in connection.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
        )
        if row[0] not in EXCLUDED_TABLES
    ]
    with Path(output).open("w", encoding="utf-8", newline="\n") as target:
        target.write("-- CAP Analytics data sync. Generated automatically; non-destructive merge.\n")
        target.write("-- Raw imported files and media are intentionally replaced with empty blobs; operational records are preserved.\n")
        target.write("PRAGMA defer_foreign_keys = ON;\n")
        for table in tables:
            schema = connection.execute(
                "SELECT sql FROM sqlite_master WHERE type='table' AND name=?", (table,)
            ).fetchone()[0]
            schema = schema.replace("CREATE TABLE ", "CREATE TABLE IF NOT EXISTS ", 1)
            target.write(schema.rstrip(";") + ";\n")
            columns = [row[1] for row in connection.execute(f"PRAGMA table_info({identifier(table)})")]
            names = ", ".join(identifier(column) for column in columns)
            placeholder = ", ".join("?" for _ in columns)
            query = f"SELECT {names} FROM {identifier(table)}"
            for row in connection.execute(query):
                values = ", ".join(value_sql(row[column], omit_binary=True) for column in columns)
                target.write(f"INSERT OR REPLACE INTO {identifier(table)} ({names}) VALUES ({values});\n")
    connection.close()


if __name__ == "__main__":
    if len(sys.argv) != 3:
        print("Gunakan: export_cap_data_sql.py <database> <output.sql>", file=sys.stderr)
        sys.exit(1)
    export_data(sys.argv[1], sys.argv[2])
