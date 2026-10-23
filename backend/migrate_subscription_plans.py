#!/usr/bin/env python3
"""
Migration script to update subscription plans from old tiers to new tiers.

Old Plans -> New Plans:
- BASIC -> SMALL_BUSINESS
- PREMIUM -> SMALL_BUSINESS (or ENTERPRISE based on users)
- ENTERPRISE -> ENTERPRISE
- FREE -> FREE

Run this once after deploying the new feature flags system.
"""

import sys

from core.database import Organization, SessionLocal, SubscriptionPlan


def migrate_subscription_plans():
    """Migrate organizations from old subscription plans to new plans"""
    db = SessionLocal()
    
    try:
        # Get all organizations
        orgs = db.query(Organization).all()
        
        print(f"Found {len(orgs)} organizations to migrate")
        print("-" * 60)
        
        migration_count = {
            "free": 0,
            "basic_to_small": 0,
            "premium_to_small": 0,
            "premium_to_enterprise": 0,
            "enterprise": 0,
            "already_migrated": 0
        }
        
        for org in orgs:
            old_plan = org.subscription_plan.value
            new_plan = None
            user_count = len(org.users) if org.users else 0
            
            print(f"\n{org.name} (ID: {org.id})")
            print(f"  Current plan: {old_plan}")
            print(f"  Users: {user_count}")
            
            # Determine new plan
            if old_plan == "free":
                new_plan = SubscriptionPlan.FREE
                migration_count["free"] += 1
                print("  ✓ Keeping FREE plan")
            
            elif old_plan == "basic":
                new_plan = SubscriptionPlan.SMALL_BUSINESS
                org.max_users = 20
                org.max_chat_sessions = 5000
                migration_count["basic_to_small"] += 1
                print("  → Migrating BASIC to SMALL_BUSINESS")
                print("  → Updated limits: 20 users, 5000 chats")
            
            elif old_plan == "premium":
                # If they have more than 20 users, upgrade to ENTERPRISE
                # Otherwise SMALL_BUSINESS
                if user_count > 20:
                    new_plan = SubscriptionPlan.ENTERPRISE
                    org.max_users = 100
                    org.max_chat_sessions = 50000
                    migration_count["premium_to_enterprise"] += 1
                    print(f"  → Migrating PREMIUM to ENTERPRISE (has {user_count} users)")
                    print("  → Updated limits: 100 users, 50000 chats")
                else:
                    new_plan = SubscriptionPlan.SMALL_BUSINESS
                    org.max_users = 20
                    org.max_chat_sessions = 5000
                    migration_count["premium_to_small"] += 1
                    print("  → Migrating PREMIUM to SMALL_BUSINESS")
                    print("  → Updated limits: 20 users, 5000 chats")
            
            elif old_plan == "enterprise":
                new_plan = SubscriptionPlan.ENTERPRISE
                org.max_users = 100
                org.max_chat_sessions = 50000
                migration_count["enterprise"] += 1
                print("  ✓ Keeping ENTERPRISE plan")
                print("  → Updated limits: 100 users, 50000 chats")
            
            elif old_plan in ["small_business"]:
                # Already migrated
                migration_count["already_migrated"] += 1
                print(f"  ✓ Already on new plan: {old_plan}")
                continue
            
            else:
                print(f"  ⚠ Unknown plan: {old_plan}, defaulting to FREE")
                new_plan = SubscriptionPlan.FREE
                migration_count["free"] += 1
            
            # Update the organization
            if new_plan:
                org.subscription_plan = new_plan
        
        # Commit all changes
        db.commit()
        
        print("\n" + "=" * 60)
        print("Migration Summary:")
        print("=" * 60)
        print(f"Total organizations: {len(orgs)}")
        print(f"  - Kept FREE: {migration_count['free']}")
        print(f"  - BASIC → SMALL_BUSINESS: {migration_count['basic_to_small']}")
        print(f"  - PREMIUM → SMALL_BUSINESS: {migration_count['premium_to_small']}")
        print(f"  - PREMIUM → ENTERPRISE: {migration_count['premium_to_enterprise']}")
        print(f"  - Kept ENTERPRISE: {migration_count['enterprise']}")
        print(f"  - Already migrated: {migration_count['already_migrated']}")
        print("\n✅ Migration completed successfully!")
        
        return True
        
    except Exception as e:
        print(f"\n❌ Error during migration: {str(e)}")
        db.rollback()
        return False
    finally:
        db.close()


def verify_migration():
    """Verify that all organizations have valid subscription plans"""
    db = SessionLocal()
    
    try:
        orgs = db.query(Organization).all()
        
        print("\n" + "=" * 60)
        print("Migration Verification:")
        print("=" * 60)
        
        valid_plans = ["free", "small_business", "enterprise"]
        invalid_orgs = []
        
        plan_counts = {plan: 0 for plan in valid_plans}
        
        for org in orgs:
            plan = org.subscription_plan.value
            if plan not in valid_plans:
                invalid_orgs.append((org.id, org.name, plan))
            else:
                plan_counts[plan] += 1
        
        if invalid_orgs:
            print("\n⚠ Found organizations with invalid plans:")
            for org_id, org_name, plan in invalid_orgs:
                print(f"  - {org_name} (ID: {org_id}): {plan}")
            return False
        else:
            print("\n✅ All organizations have valid subscription plans!")
            print("\nDistribution:")
            for plan, count in plan_counts.items():
                print(f"  - {plan.upper()}: {count} organizations")
            return True
            
    finally:
        db.close()


if __name__ == "__main__":
    print("=" * 60)
    print("UnifiedWork Subscription Plan Migration")
    print("=" * 60)
    print("\nThis will migrate all organizations to the new subscription tiers:")
    print("  - FREE (10 users, basic features)")
    print("  - SMALL_BUSINESS (20 users, enhanced features)")
    print("  - ENTERPRISE (100 users, all features)")
    print("\n" + "=" * 60)
    
    response = input("\nDo you want to proceed with the migration? (yes/no): ")
    
    if response.lower() in ['yes', 'y']:
        success = migrate_subscription_plans()
        
        if success:
            verify_migration()
            print("\n✅ Migration completed and verified!")
            sys.exit(0)
        else:
            print("\n❌ Migration failed!")
            sys.exit(1)
    else:
        print("\n❌ Migration cancelled.")
        sys.exit(0)
