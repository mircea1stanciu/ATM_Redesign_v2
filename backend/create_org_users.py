#!/usr/bin/env python3
"""
Script to create users for organizations
"""

import requests

API_BASE_URL = "http://localhost:8002"

# Login as admin to get token
def get_admin_token():
    response = requests.post(
        f"{API_BASE_URL}/api/auth/login",
        json={"username": "admin", "password": "admin123"}
    )
    return response.json()["access_token"]

def create_user(token, org_id, username, email, password, full_name, role):
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {token}"
    }
    data = {
        "username": username,
        "email": email,
        "password": password,
        "full_name": full_name,
        "role": role
    }
    response = requests.post(
        f"{API_BASE_URL}/api/organizations/{org_id}/users",
        headers=headers,
        json=data
    )
    if response.status_code == 200:
        print(f"✅ Created user: {username} ({role})")
        return True
    else:
        print(f"❌ Failed to create {username}: {response.text}")
        return False

# Organization configurations
organizations = [
    {
        "id": 3,
        "name": "Raiffeisen Bank Romania",
        "slug": "raiffeisen-bank-romania",
        "prefix": "raiff"
    },
    {
        "id": 4,
        "name": "Unicredit Romania",
        "slug": "unicredit-romania",
        "prefix": "unicredit"
    },
    {
        "id": 5,
        "name": "Bearing Point",
        "slug": "bearing-point",
        "prefix": "bp"
    }
]

# Roles to create (2 users per role)
roles = [
    "qa_engineer",
    "backend_dev",
    "frontend_dev",
    "ui_designer",
    "product_manager",
    "devops_engineer",
    "analyst"
]

def main():
    print("🚀 Starting user creation process...\n")
    token = get_admin_token()
    print("✅ Admin token obtained\n")
    
    total_created = 0
    
    for org in organizations:
        print(f"\n{'='*60}")
        print(f"📂 Creating users for: {org['name']}")
        print(f"{'='*60}\n")
        
        org_created = 0
        
        # Create 2 users for each role
        for role in roles:
            for i in range(1, 3):
                username = f"{org['prefix']}_user_{role}_{i:02d}"
                email = f"{org['prefix']}_{role}_{i:02d}@{org['slug'].replace('-', '')}.com"
                password = f"{org['prefix'].capitalize()}@{role}{i}"
                full_name = f"{org['name']} {role.replace('_', ' ').title()} {i:02d}"
                
                if create_user(token, org['id'], username, email, password, full_name, role):
                    org_created += 1
                    total_created += 1
        
        # Create 2 community-assigned users (regular users with community access)
        for i in range(1, 3):
            username = f"{org['prefix']}_community_user_{i:02d}"
            email = f"{org['prefix']}_community_{i:02d}@{org['slug'].replace('-', '')}.com"
            password = f"{org['prefix'].capitalize()}@Community{i}"
            full_name = f"{org['name']} Community User {i:02d}"
            
            if create_user(token, org['id'], username, email, password, full_name, "user"):
                org_created += 1
                total_created += 1
        
        print(f"\n📊 Created {org_created} users for {org['name']}")
    
    print(f"\n{'='*60}")
    print(f"🎉 COMPLETED! Total users created: {total_created}")
    print(f"{'='*60}\n")

if __name__ == "__main__":
    main()
