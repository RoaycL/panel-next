#!/usr/bin/env python3
"""
Migrate configuration and database data from original Sun-Panel (SQLite)
to Panel Next (PostgreSQL).
"""
import os
import shutil
import sqlite3
import psycopg2
from psycopg2.extras import RealDictCursor

SQLITE_PATH = "/opt/stacks/sun-panel/conf/database/database.db"
SOURCE_UPLOADS = "/opt/stacks/sun-panel/conf/uploads"
DEST_UPLOADS = "/root/panel-next/service/uploads"

PG_CONFIG = {
    "host": "127.0.0.1",
    "port": 5432,
    "user": "panel_next",
    "password": "0fb1dc5f4e63ee96e2cd4ba837ad6dae5ec61e3532a91a5be9299f29a9b07a75",
    "dbname": "panel_next",
}

def migrate_database():
    print("=== Step 1: Connecting to SQLite and PostgreSQL ===")
    s_conn = sqlite3.connect(SQLITE_PATH)
    s_conn.row_factory = sqlite3.Row
    s_cur = s_conn.cursor()

    p_conn = psycopg2.connect(**PG_CONFIG)
    p_cur = p_conn.cursor()

    tables_to_truncate = [
        "user_sync_change",
        "user_sync_state",
        "user_session_refresh_token",
        "user_session",
        "item_icon",
        "item_icon_group",
        "file",
        "public_file",
        "module_config",
        "user_config",
        "\"user\"",
        "system_setting",
    ]

    print("Cleaning target PostgreSQL tables...")
    for tbl in tables_to_truncate:
        try:
            p_cur.execute(f"TRUNCATE TABLE {tbl} CASCADE;")
        except Exception as e:
            print(f"Warning truncating {tbl}: {e}")
            p_conn.rollback()
            p_cur = p_conn.cursor()
    p_conn.commit()

    # 1. Migrate user
    print("Migrating 'user' table...")
    s_cur.execute("SELECT id, created_at, updated_at, deleted_at, username, password, name, head_image, status, role, mail, referral_code, token FROM user")
    users = s_cur.fetchall()
    for u in users:
        p_cur.execute("""
            INSERT INTO "user" (id, created_at, updated_at, deleted_at, username, password, name, head_image, status, role, mail, referral_code, token)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        """, (
            u["id"], u["created_at"], u["updated_at"], u["deleted_at"],
            u["username"], u["password"], u["name"], u["head_image"],
            u["status"], u["role"], u["mail"], u["referral_code"], u["token"]
        ))
    print(f"  -> Migrated {len(users)} user(s)")

    # 2. Migrate system_setting
    print("Migrating 'system_setting' table...")
    s_cur.execute("SELECT id, config_name, config_value FROM system_setting")
    settings = s_cur.fetchall()
    for s in settings:
        p_cur.execute("""
            INSERT INTO system_setting (id, config_name, config_value)
            VALUES (%s, %s, %s)
        """, (s["id"], s["config_name"], s["config_value"]))
    print(f"  -> Migrated {len(settings)} system setting(s)")

    # 3. Migrate user_config
    print("Migrating 'user_config' table...")
    s_cur.execute("SELECT user_id, panel_json, search_engine_json FROM user_config")
    configs = s_cur.fetchall()
    for c in configs:
        p_cur.execute("""
            INSERT INTO user_config (user_id, panel_json, search_engine_json, revision, updated_at)
            VALUES (%s, %s, %s, 1, NOW())
        """, (c["user_id"], c["panel_json"], c["search_engine_json"]))
    print(f"  -> Migrated {len(configs)} user config(s)")

    # 4. Migrate item_icon_group
    print("Migrating 'item_icon_group' table...")
    s_cur.execute("SELECT id, created_at, updated_at, deleted_at, icon, title, description, sort, user_id FROM item_icon_group")
    groups = s_cur.fetchall()
    for g in groups:
        p_cur.execute("""
            INSERT INTO item_icon_group (id, created_at, updated_at, deleted_at, icon, title, description, sort, user_id, revision)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, 1)
        """, (
            g["id"], g["created_at"], g["updated_at"], g["deleted_at"],
            g["icon"], g["title"], g["description"], g["sort"], g["user_id"]
        ))
    print(f"  -> Migrated {len(groups)} group(s)")

    # 5. Migrate item_icon
    print("Migrating 'item_icon' table...")
    s_cur.execute("SELECT id, created_at, updated_at, deleted_at, icon_json, title, url, lan_url, description, open_method, sort, item_icon_group_id, user_id FROM item_icon")
    icons = s_cur.fetchall()
    for ic in icons:
        p_cur.execute("""
            INSERT INTO item_icon (id, created_at, updated_at, deleted_at, icon_json, title, url, lan_url, description, open_method, sort, item_icon_group_id, user_id, revision)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, 1)
        """, (
            ic["id"], ic["created_at"], ic["updated_at"], ic["deleted_at"],
            ic["icon_json"], ic["title"], ic["url"], ic["lan_url"],
            ic["description"], ic["open_method"], ic["sort"],
            ic["item_icon_group_id"], ic["user_id"]
        ))
    print(f"  -> Migrated {len(icons)} icon(s)")

    # 6. Migrate file
    print("Migrating 'file' table...")
    s_cur.execute("SELECT id, created_at, updated_at, deleted_at, src, user_id, file_name, type, ext FROM file")
    files = s_cur.fetchall()
    for f in files:
        # Map integer type to string type
        raw_type = f["type"]
        type_str = "icon"
        if raw_type == 1:
            type_str = "wallpaper"
        elif raw_type == 2:
            type_str = "icon"
        else:
            type_str = "other"

        p_cur.execute("""
            INSERT INTO file (id, created_at, updated_at, deleted_at, src, user_id, file_name, method, ext, type)
            VALUES (%s, %s, %s, %s, %s, %s, %s, 1, %s, %s)
        """, (
            f["id"], f["created_at"], f["updated_at"], f["deleted_at"],
            f["src"], f["user_id"], f["file_name"], f["ext"], type_str
        ))
    print(f"  -> Migrated {len(files)} file(s)")

    # 7. Migrate module_config
    print("Migrating 'module_config' table...")
    s_cur.execute("SELECT id, created_at, updated_at, deleted_at, user_id, name, value_json FROM module_config")
    modules = s_cur.fetchall()
    for m in modules:
        p_cur.execute("""
            INSERT INTO module_config (id, created_at, updated_at, deleted_at, user_id, name, value_json)
            VALUES (%s, %s, %s, %s, %s, %s, %s)
        """, (
            m["id"], m["created_at"], m["updated_at"], m["deleted_at"],
            m["user_id"], m["name"], m["value_json"]
        ))
    print(f"  -> Migrated {len(modules)} module config(s)")

    # Reset sequences for auto-increment fields
    print("Resetting PostgreSQL sequences...")
    sequences = [
        ("user", "user_id_seq"),
        ("system_setting", "system_setting_id_seq"),
        ("item_icon_group", "item_icon_group_id_seq"),
        ("item_icon", "item_icon_id_seq"),
        ("file", "file_id_seq"),
        ("module_config", "module_config_id_seq"),
    ]
    for table, seq in sequences:
        tbl_sql = f'"{table}"' if table == "user" else table
        p_cur.execute(f"SELECT COALESCE(MAX(id), 0) + 1 FROM {tbl_sql};")
        next_id = p_cur.fetchone()[0]
        p_cur.execute(f"SELECT setval('{seq}', %s, false);", (next_id,))
        print(f"  -> Set {seq} next val to {next_id}")

    p_conn.commit()
    s_conn.close()
    p_conn.close()
    print("Database migration completed successfully!")

def migrate_uploads():
    print("=== Step 2: Syncing uploads directory ===")
    if not os.path.exists(SOURCE_UPLOADS):
        print(f"Source uploads path '{SOURCE_UPLOADS}' does not exist, skipping.")
        return

    os.makedirs(DEST_UPLOADS, exist_ok=True)
    os.system(f"cp -a {SOURCE_UPLOADS}/* {DEST_UPLOADS}/ 2>/dev/null || true")
    print(f"Synced files from {SOURCE_UPLOADS} to {DEST_UPLOADS}")

if __name__ == "__main__":
    migrate_database()
    migrate_uploads()
