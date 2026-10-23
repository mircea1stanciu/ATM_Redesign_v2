#!/usr/bin/env python3
"""
Script to assign communities to community users
"""
import json
import sqlite3

# Community assignments - will assign 2 different communities to each pair of users
COMMUNITY_ASSIGNMENTS = {
    # First community user gets qa and backend
    1: ["qa", "backend"],
    # Second community user gets frontend and design
    2: ["frontend", "design"]
}

def update_community_assignments():
    conn = sqlite3.connect('unifiedwork.db')
    cursor = conn.cursor()
    
    print("="*70)
    print("🏘️  ASSIGNING COMMUNITIES TO USERS")
    print("="*70)
    
    # Get all community users from each organization
    for org_id, org_name, org_prefix in [
        (3, "Raiffeisen Bank Romania", "raiff"),
        (4, "Unicredit Romania", "unicredit"),
        (5, "Bearing Point", "bp")
    ]:
        print(f"\n🏢 {org_name}:")
        
        # Get the 2 community users for this organization
        cursor.execute("""
            SELECT id, username
            FROM users
            WHERE organization_id = ?
            AND username LIKE ?
            ORDER BY username
        """, (org_id, f"{org_prefix}_community_user_%"))
        
        community_users = cursor.fetchall()
        
        for idx, (user_id, username) in enumerate(community_users, 1):
            if idx in COMMUNITY_ASSIGNMENTS:
                communities = COMMUNITY_ASSIGNMENTS[idx]
                communities_json = json.dumps(communities)
                
                # Update the user's assigned_communities
                cursor.execute("""
                    UPDATE users
                    SET assigned_communities = ?
                    WHERE id = ?
                """, (communities_json, user_id))
                
                print(f"   ✅ {username}: {', '.join(communities)}")
            else:
                print(f"   ⚠️  {username}: No assignment defined for index {idx}")
    
    conn.commit()
    
    # Verify updates
    print(f"\n{'='*70}")
    print("📊 VERIFICATION - Users with Community Assignments")
    print(f"{'='*70}\n")
    
    cursor.execute("""
        SELECT u.username, u.assigned_communities, o.name
        FROM users u
        JOIN organizations o ON u.organization_id = o.id
        WHERE u.assigned_communities IS NOT NULL
        AND u.organization_id >= 3
        ORDER BY o.id, u.username
    """)
    
    assigned_users = cursor.fetchall()
    
    if assigned_users:
        current_org = None
        for username, communities_json, org_name in assigned_users:
            if current_org != org_name:
                print(f"\n🏢 {org_name}:")
                current_org = org_name
            
            communities = json.loads(communities_json)
            community_names = {
                'qa': 'QA Engineers',
                'backend': 'Backend Developers',
                'frontend': 'Frontend Developers',
                'design': 'UI/UX Designers',
                'product': 'Product Managers',
                'devops': 'DevOps Engineers',
                'docs': 'Technical Writers'
            }
            
            comm_display = [community_names.get(c, c) for c in communities]
            print(f"   • {username}: {', '.join(comm_display)}")
    else:
        print("   ⚠️  No users with community assignments found")
    
    print(f"\n{'='*70}")
    print("✅ COMMUNITY ASSIGNMENTS COMPLETED!")
    print(f"{'='*70}\n")
    
    conn.close()

if __name__ == "__main__":
    update_community_assignments()
