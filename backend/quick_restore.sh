#!/bin/bash
# Quick Restore Script - Restores from the safe backup

cd /Users/t026stanm/Desktop/Automation/UnifiedWork/unified-workspace-app-321123/backend

echo "🔄 Restoring database from safe backup..."
echo ""
./venv/bin/python3 backup_manager.py restore

echo ""
echo "✅ Database has been restored!"
echo ""
echo "💡 Don't forget to restart the backend server if it's running."
