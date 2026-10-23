# Database Migrations

This directory contains database migration scripts for the UnifiedWork application.

## Important Note

**NEVER delete the database file (`unifiedwork.db`) in production!** This will result in permanent data loss.

Instead, always use migration scripts to update the database schema while preserving existing data.

## How to Create a Migration

1. Create a new Python file in this directory with a descriptive name:
   ```
   migrations/add_new_feature_columns.py
   ```

2. Use the template from `add_2fa_columns.py` as a starting point

3. Test the migration on a copy of the database first

4. Run the migration:
   ```bash
   cd backend
   python migrations/your_migration_file.py
   ```

## Existing Migrations

### add_2fa_columns.py
**Date**: 2025-10-25
**Description**: Adds Two-Factor Authentication support
**Columns Added**:
- `users.two_fa_enabled` (BOOLEAN, default=False)
- `users.two_fa_secret` (VARCHAR, nullable)

**Usage**:
```bash
cd backend
python migrations/add_2fa_columns.py
```

## Best Practices

1. **Always backup the database before running migrations**:
   ```bash
   cp unifiedwork.db unifiedwork.db.backup
   ```

2. **Test migrations on a copy first**:
   ```bash
   cp unifiedwork.db test_unifiedwork.db
   # Test migration on test_unifiedwork.db
   ```

3. **Check if columns/tables exist before adding them** to make migrations idempotent (safe to run multiple times)

4. **Document each migration** with date, description, and affected tables

5. **Never modify old migrations** - create new ones instead

## Recovery from Accidental Database Deletion

If the database was accidentally deleted:

1. The application will automatically recreate the database with default data on next startup
2. Default organizations and users will be created
3. Any custom data (additional organizations, users, chat sessions) will be lost
4. Restore from the most recent backup if available

## Future Improvements

Consider implementing:
- Alembic or similar migration framework for automatic versioning
- Automated backup system before migrations
- Migration rollback support
- Migration history tracking in the database
