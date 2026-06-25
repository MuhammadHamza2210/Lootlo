# -*- coding: utf-8 -*-
"""
view_db.py  --  Read your LootLo database in clean, human-readable text.

The real database is lootlo.db (a binary SQLite file - don't open that in a
text editor, it will look like garbage). Run THIS instead:

    python view_db.py            # print every table to the screen
    python view_db.py users      # print just one table
    python view_db.py --export   # also write a readable database_export.txt

Your data always lives safely in lootlo.db and survives shutdowns.
This script only READS it - it never changes or deletes anything.
"""

import os
import sys
import sqlite3
import io

# Force clean UTF-8 output so nothing crashes on Windows.
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, "lootlo.db")

# Sensitive columns we never print in full.
HIDE = {"password", "token"}


def all_tables(db):
    rows = db.execute(
        "SELECT name FROM sqlite_master WHERE type='table' "
        "AND name NOT LIKE 'sqlite_%' ORDER BY name"
    ).fetchall()
    return [r[0] for r in rows]


def render_table(db, table):
    rows = db.execute(f"SELECT * FROM {table}").fetchall()
    out = []
    out.append("=" * 70)
    out.append(f"  {table.upper()}   ({len(rows)} rows)")
    out.append("=" * 70)
    if not rows:
        out.append("  (empty)")
        out.append("")
        return "\n".join(out)

    cols = rows[0].keys()
    for i, row in enumerate(rows, 1):
        out.append(f"#{i}")
        for c in cols:
            val = row[c]
            if c in HIDE and val:
                val = "(hidden)"
            out.append(f"   {c:<16}: {val}")
        out.append("")
    return "\n".join(out)


def main():
    if not os.path.exists(DB_PATH):
        print("No database found yet. Run  python app.py  once to create it.")
        return

    args = [a for a in sys.argv[1:] if a != "--export"]
    export = "--export" in sys.argv

    db = sqlite3.connect(DB_PATH)
    db.row_factory = sqlite3.Row

    tables = all_tables(db)
    wanted = args if args else tables

    chunks = []
    for t in wanted:
        if t not in tables:
            print(f"(no table named '{t}'. Tables: {', '.join(tables)})")
            continue
        chunks.append(render_table(db, t))

    report = "\n".join(chunks)
    print(report)

    if export:
        path = os.path.join(BASE_DIR, "database_export.txt")
        with open(path, "w", encoding="utf-8") as f:
            f.write(report)
        print(f"\nSaved a readable copy to: {path}")

    db.close()


if __name__ == "__main__":
    main()
