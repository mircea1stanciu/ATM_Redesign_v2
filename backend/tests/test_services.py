from uuid import uuid4

import pytest


class TestAuthService:
    """Test suite for authentication service."""
    
    @pytest.mark.asyncio
    async def test_token_creation(self):
        """Test JWT token creation."""
        from app.core.security import create_access_token, create_refresh_token, decode_token
        
        user_id = str(uuid4())
        
        # Create tokens
        access_token = create_access_token(user_id)
        refresh_token = create_refresh_token(user_id)
        
        # Tokens should not be empty
        assert len(access_token) > 0
        assert len(refresh_token) > 0
        
        # Decode and verify
        access_payload = decode_token(access_token)
        refresh_payload = decode_token(refresh_token)
        
        assert access_payload.get("sub") == user_id
        assert access_payload.get("type") == "access"
        
        assert refresh_payload.get("sub") == user_id
        assert refresh_payload.get("type") == "refresh"
    
    @pytest.mark.asyncio
    async def test_invalid_token_decode(self):
        """Test decoding invalid token."""
        from app.core.security import decode_token
        
        result = decode_token("invalid.token.here")
        assert result == {}
