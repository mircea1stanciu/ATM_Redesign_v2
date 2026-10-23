#!/bin/bash
# Quick Backup Script - Run this anytime you want to backup your database

cd /Users/t026stanm/Desktop/Automation/UnifiedWork/unified-workspace-app-321123/backend

echo "🔄 Creating database backup..."
./venv/bin/python3 backup_manager.py backup

echo ""
echo "📋 All backups:"
./venv/bin/python3 backup_manager.py list
