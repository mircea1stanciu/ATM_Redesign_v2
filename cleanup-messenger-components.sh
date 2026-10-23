#!/bin/bash

# Team Messaging Cleanup Script
# Consolidates MessengerView components

echo "🧹 Team Messaging Component Cleanup"
echo "===================================="
echo ""

FRONTEND_DIR="../frontend/src/components"

# Check if we're in the right directory
if [ ! -d "$FRONTEND_DIR" ]; then
    echo "❌ Error: Frontend components directory not found"
    echo "   Please run this script from the project root or e2e-tests directory"
    exit 1
fi

echo "📍 Working directory: $(pwd)"
echo "📂 Components directory: $FRONTEND_DIR"
echo ""

# Create archive directory if it doesn't exist
ARCHIVE_DIR="$FRONTEND_DIR/archive"
mkdir -p "$ARCHIVE_DIR"
echo "✅ Archive directory ready: $ARCHIVE_DIR"
echo ""

# Step 1: Check which files exist
echo "📋 Checking MessengerView files..."
echo ""

if [ -f "$FRONTEND_DIR/MessengerView.tsx" ]; then
    LINES_MAIN=$(wc -l < "$FRONTEND_DIR/MessengerView.tsx")
    echo "✅ MessengerView.tsx exists ($LINES_MAIN lines) - PRODUCTION VERSION"
else
    echo "❌ MessengerView.tsx NOT FOUND"
fi

if [ -f "$FRONTEND_DIR/MessengerViewNew.tsx" ]; then
    LINES_NEW=$(wc -l < "$FRONTEND_DIR/MessengerViewNew.tsx")
    echo "⚠️  MessengerViewNew.tsx exists ($LINES_NEW lines) - TO BE ARCHIVED"
else
    echo "ℹ️  MessengerViewNew.tsx not found (already removed)"
fi

if [ -f "$FRONTEND_DIR/MessengerViewTemp.tsx" ]; then
    LINES_TEMP=$(wc -l < "$FRONTEND_DIR/MessengerViewTemp.tsx")
    echo "⚠️  MessengerViewTemp.tsx exists ($LINES_TEMP lines) - TO BE DELETED"
else
    echo "ℹ️  MessengerViewTemp.tsx not found (already removed)"
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Ask for confirmation
read -p "Do you want to proceed with cleanup? (y/N) " -n 1 -r
echo ""

if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "❌ Cleanup cancelled"
    exit 0
fi

echo ""
echo "🚀 Starting cleanup..."
echo ""

# Step 2: Archive MessengerViewNew.tsx
if [ -f "$FRONTEND_DIR/MessengerViewNew.tsx" ]; then
    echo "📦 Archiving MessengerViewNew.tsx..."
    mv "$FRONTEND_DIR/MessengerViewNew.tsx" "$ARCHIVE_DIR/MessengerViewNew.tsx.backup"
    
    if [ $? -eq 0 ]; then
        echo "✅ Archived: $ARCHIVE_DIR/MessengerViewNew.tsx.backup"
        
        # Create info file
        cat > "$ARCHIVE_DIR/MessengerViewNew.README.txt" << EOF
MessengerViewNew.tsx - Archived $(date)

This file was an alternative/experimental version of the MessengerView component.
It has been archived because:
- MessengerView.tsx is the production version (1,261 lines)
- MessengerViewNew.tsx was less complete (564 lines)
- Missing features: file attachments, reactions, organization users tab

The production MessengerView.tsx includes all features:
- ✅ File attachments with drag-drop
- ✅ Message reactions
- ✅ Group conversations
- ✅ Organization users list
- ✅ WebSocket real-time updates

This archived file can be deleted after confirming no needed features were lost.
EOF
        echo "📝 Created: $ARCHIVE_DIR/MessengerViewNew.README.txt"
    else
        echo "❌ Failed to archive MessengerViewNew.tsx"
    fi
else
    echo "ℹ️  MessengerViewNew.tsx already removed or doesn't exist"
fi

echo ""

# Step 3: Delete MessengerViewTemp.tsx
if [ -f "$FRONTEND_DIR/MessengerViewTemp.tsx" ]; then
    echo "🗑️  Deleting MessengerViewTemp.tsx..."
    
    # Create a backup in archive just in case
    cp "$FRONTEND_DIR/MessengerViewTemp.tsx" "$ARCHIVE_DIR/MessengerViewTemp.tsx.deleted"
    echo "📦 Backup created in archive (can be deleted later)"
    
    # Delete the file
    rm "$FRONTEND_DIR/MessengerViewTemp.tsx"
    
    if [ $? -eq 0 ]; then
        echo "✅ Deleted: MessengerViewTemp.tsx"
        
        # Create info file
        cat > "$ARCHIVE_DIR/MessengerViewTemp.README.txt" << EOF
MessengerViewTemp.tsx - Deleted $(date)

This file was a placeholder "Coming Soon" component with no functionality.
It has been deleted because:
- Only 103 lines
- Just displayed "Team Messaging Coming Soon" message
- No actual functionality
- MessengerView.tsx is the real, functional implementation

A backup exists in this archive directory and can be deleted.
EOF
        echo "📝 Created: $ARCHIVE_DIR/MessengerViewTemp.README.txt"
    else
        echo "❌ Failed to delete MessengerViewTemp.tsx"
    fi
else
    echo "ℹ️  MessengerViewTemp.tsx already removed or doesn't exist"
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "✅ Cleanup Complete!"
echo ""
echo "📊 Results:"
echo "  ✅ MessengerView.tsx (PRODUCTION) - KEPT"
echo "  📦 MessengerViewNew.tsx - ARCHIVED"
echo "  🗑️  MessengerViewTemp.tsx - DELETED"
echo ""
echo "📂 Archive location: $ARCHIVE_DIR"
echo ""
echo "🎯 Next Steps:"
echo "  1. Run your application to verify everything works"
echo "  2. Test the MessengerView component thoroughly"
echo "  3. If all is well, you can delete the archive/ folder after a few days"
echo ""
echo "📚 See TEAM_MESSAGING_COMPLETE.md for full documentation"
echo ""
